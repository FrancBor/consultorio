import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { requireAuthentication, requireRole } from '../src/middleware/authentication.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import {
  createAdminUsersRepository,
  AdminUserRepositoryError,
} from '../src/modules/admin-users/repository.js';
import { createAdminUsersRouter } from '../src/modules/admin-users/routes.js';
import {
  createUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
} from '../src/modules/admin-users/schemas.js';
import { createAdminUsersService } from '../src/modules/admin-users/service.js';
import { createSessionMiddleware } from '../src/modules/auth/session.js';

const cookieName = 'consultorio.sid';

function publicUser(overrides = {}) {
  return {
    id: '2',
    usuario: 'consulta',
    nombre: 'Cuenta de consulta',
    correo: 'consulta@example.test',
    rol: 'consulta',
    activo: true,
    ultimo_acceso_en: null,
    creado_en: '2026-10-17T12:00:00.000Z',
    actualizado_en: '2026-10-17T12:00:00.000Z',
    ...overrides,
  };
}

function transactionalPool({ target = publicUser(), activeAdminIds = ['1'] } = {}) {
  let current = target ? { auth_version: '1', ...target } : null;
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql, params = []) => {
      const normalized = sql.replaceAll(/\s+/g, ' ').trim();

      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [] };
      if (normalized.includes("WHERE rol_codigo = 'admin' AND activo = TRUE")) {
        return { rows: activeAdminIds.map((id) => ({ id })) };
      }
      if (normalized.includes('FROM usuarios AS u') && normalized.includes('FOR UPDATE')) {
        return { rows: current ? [{ ...current }] : [] };
      }
      if (normalized.startsWith('SELECT id, auth_version::text AS auth_version')) {
        return {
          rows: current ? [{ id: current.id, auth_version: current.auth_version }] : [],
        };
      }
      if (normalized.startsWith('UPDATE usuarios SET nombre_mostrar')) {
        current = {
          ...current,
          nombre: params[1],
          rol: params[2],
          activo: params[3],
          auth_version: params[4]
            ? String(BigInt(current.auth_version) + 1n)
            : current.auth_version,
          actualizado_en: '2026-10-17T13:00:00.000Z',
        };
        return { rows: [{ ...current }] };
      }
      if (normalized.startsWith('UPDATE usuarios SET password_hash')) {
        current = {
          ...current,
          auth_version: String(BigInt(current.auth_version) + 1n),
          actualizado_en: '2026-10-17T13:00:00.000Z',
        };
        return { rows: [{ ...current }] };
      }
      if (normalized.startsWith('DELETE FROM sesiones_http')) return { rows: [] };

      throw new Error(`Unexpected query: ${normalized}`);
    }),
  };

  return {
    client,
    pool: { connect: vi.fn().mockResolvedValue(client) },
  };
}

describe('admin user schemas', () => {
  it('parses list defaults and optional filters while rejecting unknown parameters', () => {
    expect(listUsersQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(
      listUsersQuerySchema.parse({
        page: '3',
        limit: '100',
        search: '  Cuenta  ',
        role: 'consulta',
        active: 'false',
      }),
    ).toEqual({ page: 3, limit: 100, search: 'Cuenta', role: 'consulta', active: false });
    expect(listUsersQuerySchema.safeParse({ unknown: 'value' }).success).toBe(false);
    expect(listUsersQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('validates create, patch, and password contracts strictly', () => {
    expect(
      createUserSchema.parse({
        usuario: ' Cuenta.Admin ',
        nombre: ' Cuenta administradora ',
        correo: '',
        rol: 'admin',
        password: 'synthetic-password',
      }),
    ).toEqual({
      usuario: 'Cuenta.Admin',
      nombre: 'Cuenta administradora',
      correo: undefined,
      rol: 'admin',
      password: 'synthetic-password',
    });
    expect(updateUserSchema.safeParse({}).success).toBe(false);
    expect(updateUserSchema.safeParse({ usuario: 'immutable' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: 'short' }).success).toBe(false);
  });
});

describe('admin user repository', () => {
  it('lists users in one snapshot-consistent query without selecting password hashes', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { total: 2, ...publicUser({ id: '1', usuario: 'admin', rol: 'admin' }) },
          { total: 2, ...publicUser() },
        ],
      }),
    };
    const repository = createAdminUsersRepository(pool);

    await expect(
      repository.list({ page: 2, limit: 20, search: 'cuenta', role: 'consulta', active: true }),
    ).resolves.toMatchObject({ total: 2, users: [{ id: '1' }, { id: '2' }] });

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('MATERIALIZED');
    expect(sql).toContain('count(*) OVER()');
    expect(sql).not.toContain('password_hash');
    expect(params).toEqual(['cuenta', 'consulta', true, 20, 20]);
  });

  it('returns an explicit no-op without updating the row', async () => {
    const context = transactionalPool({ target: publicUser() });
    const repository = createAdminUsersRepository(context.pool);

    await expect(
      repository.update({
        targetId: '2',
        actorId: '1',
        patch: { nombre: 'Cuenta de consulta', rol: 'consulta', activo: true },
      }),
    ).resolves.toMatchObject({ changed: false, user: { id: '2' } });
    expect(
      context.client.query.mock.calls.some(([sql]) => sql.includes('UPDATE usuarios')),
    ).toBe(false);
  });

  it('prevents removing the last active administrator after locking active admins', async () => {
    const context = transactionalPool({
      target: publicUser({ id: '1', usuario: 'admin', rol: 'admin' }),
      activeAdminIds: ['1'],
    });
    const repository = createAdminUsersRepository(context.pool);

    await expect(
      repository.update({ targetId: '1', actorId: '2', patch: { activo: false } }),
    ).rejects.toMatchObject({ code: 'last_active_admin' });
    expect(context.client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(context.client.release).toHaveBeenCalledOnce();
  });

  it('prevents self-deactivation or self-demotion even when another admin exists', async () => {
    const context = transactionalPool({
      target: publicUser({ id: '1', usuario: 'admin', rol: 'admin' }),
      activeAdminIds: ['1', '2'],
    });
    const repository = createAdminUsersRepository(context.pool);

    await expect(
      repository.update({ targetId: '1', actorId: '1', patch: { rol: 'consulta' } }),
    ).rejects.toMatchObject({ code: 'self_protection' });
  });

  it('increments auth version and revokes sessions on every active-state change', async () => {
    const deactivate = transactionalPool({ target: publicUser() });
    const deactivateRepository = createAdminUsersRepository(deactivate.pool);

    await expect(
      deactivateRepository.update({ targetId: '2', actorId: '1', patch: { activo: false } }),
    ).resolves.toMatchObject({ changed: true, user: { activo: false } });
    const deletion = deactivate.client.query.mock.calls.find(([sql]) =>
      sql.includes('DELETE FROM sesiones_http'),
    );
    expect(deletion[1]).toEqual(['2']);
    expect(
      deactivate.client.query.mock.calls.find(([sql]) => sql.includes('SET nombre_mostrar'))[1],
    ).toEqual(['2', 'Cuenta de consulta', 'consulta', false, true]);

    const reactivate = transactionalPool({ target: publicUser({ activo: false }) });
    const reactivateRepository = createAdminUsersRepository(reactivate.pool);
    await expect(
      reactivateRepository.update({ targetId: '2', actorId: '1', patch: { activo: true } }),
    ).resolves.toMatchObject({ changed: true, user: { activo: true } });
    expect(
      reactivate.client.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM sesiones_http')),
    ).toBe(true);
  });

  it('does not increment auth version or revoke sessions for a name-only change', async () => {
    const context = transactionalPool({ target: publicUser() });
    const repository = createAdminUsersRepository(context.pool);

    await repository.update({
      targetId: '2',
      actorId: '1',
      patch: { nombre: 'Nuevo nombre' },
    });

    expect(
      context.client.query.mock.calls.find(([sql]) => sql.includes('SET nombre_mostrar'))[1],
    ).toEqual(['2', 'Nuevo nombre', 'consulta', true, false]);
    expect(
      context.client.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM sesiones_http')),
    ).toBe(false);
  });

  it('increments auth version and revokes sessions for a role change', async () => {
    const context = transactionalPool({ target: publicUser(), activeAdminIds: ['1'] });
    const repository = createAdminUsersRepository(context.pool);

    await repository.update({ targetId: '2', actorId: '1', patch: { rol: 'admin' } });

    expect(
      context.client.query.mock.calls.find(([sql]) => sql.includes('SET nombre_mostrar'))[1],
    ).toEqual(['2', 'Cuenta de consulta', 'admin', true, true]);
    expect(
      context.client.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM sesiones_http')),
    ).toBe(true);
  });

  it('resets a password and revokes every stored session for the target user', async () => {
    const context = transactionalPool({ target: publicUser() });
    const repository = createAdminUsersRepository(context.pool);

    await expect(
      repository.resetPassword({ targetId: '2', passwordHash: 'argon2id-hash' }),
    ).resolves.toMatchObject({ id: '2' });
    expect(
      context.client.query.mock.calls.find(([sql]) => sql.includes('password_hash'))[1],
    ).toEqual(['2', 'argon2id-hash']);
    expect(
      context.client.query.mock.calls.find(([sql]) => sql.includes('DELETE FROM sesiones_http'))[1],
    ).toEqual(['2']);
  });

  it('rejects auth-version overflow without changing credentials or sessions', async () => {
    const context = transactionalPool({
      target: publicUser({ auth_version: '9223372036854775807' }),
    });
    const repository = createAdminUsersRepository(context.pool);

    await expect(
      repository.resetPassword({ targetId: '2', passwordHash: 'argon2id-hash' }),
    ).rejects.toMatchObject({ code: 'auth_version_overflow' });
    expect(
      context.client.query.mock.calls.some(([sql]) => sql.includes('UPDATE usuarios')),
    ).toBe(false);
    expect(
      context.client.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM sesiones_http')),
    ).toBe(false);
  });
});

describe('admin user service', () => {
  it('normalizes account data, hashes the password, and strips secret fields', async () => {
    const repository = {
      create: vi.fn().mockResolvedValue({ ...publicUser(), password_hash: 'must-not-leak' }),
    };
    const hashPassword = vi.fn().mockResolvedValue('argon2id-hash');
    const service = createAdminUsersService({ repository, hashPassword });

    const user = await service.create({
      usuario: ' CONSULTA ',
      nombre: ' Cuenta de consulta ',
      correo: 'CONSULTA@EXAMPLE.TEST',
      rol: 'consulta',
      password: 'synthetic-password',
    });

    expect(hashPassword).toHaveBeenCalledWith('synthetic-password');
    expect(repository.create).toHaveBeenCalledWith({
      username: 'consulta',
      name: 'Cuenta de consulta',
      email: 'consulta@example.test',
      role: 'consulta',
      passwordHash: 'argon2id-hash',
    });
    expect(user).not.toHaveProperty('password_hash');
    expect(JSON.stringify(user)).not.toContain('synthetic-password');
  });

  it.each([
    ['uq_usuarios_usuario_lower', 'duplicate_username'],
    ['uq_usuarios_correo_lower', 'duplicate_email'],
  ])('maps unique constraint %s to a safe conflict', async (constraint, code) => {
    const repository = {
      create: vi.fn().mockRejectedValue({ code: '23505', constraint, detail: 'sensitive SQL' }),
    };
    const service = createAdminUsersService({
      repository,
      hashPassword: vi.fn().mockResolvedValue('argon2id-hash'),
    });

    await expect(
      service.create({
        usuario: 'consulta',
        nombre: 'Consulta',
        rol: 'consulta',
        password: 'synthetic-password',
      }),
    ).rejects.toMatchObject({ status: 409, code });
  });

  it.each([
    ['not_found', 404, 'user_not_found'],
    ['self_protection', 409, 'self_protection'],
    ['last_active_admin', 409, 'last_active_admin'],
    ['auth_version_overflow', 409, 'auth_version_exhausted'],
  ])('maps repository error %s safely', async (repositoryCode, status, code) => {
    const repository = {
      update: vi.fn().mockRejectedValue(new AdminUserRepositoryError(repositoryCode)),
    };
    const service = createAdminUsersService({ repository });

    await expect(
      service.update({ targetId: '2', actorId: '1', patch: { activo: false } }),
    ).rejects.toMatchObject({ status, code });
  });
});

function buildRouterApp() {
  const accounts = new Map([
    ['1', { id: '1', usuario: 'admin', nombre_mostrar: 'Admin', rol_codigo: 'admin', auth_version: '1' }],
    ['2', { id: '2', usuario: 'consulta', nombre_mostrar: 'Consulta', rol_codigo: 'consulta', auth_version: '1' }],
  ]);
  const authRepository = {
    findActiveById: vi.fn(async (id) => accounts.get(String(id)) ?? null),
  };
  const service = {
    list: vi.fn().mockResolvedValue({ total: 1, users: [publicUser()] }),
    create: vi.fn().mockResolvedValue(publicUser()),
    update: vi.fn().mockResolvedValue({ user: publicUser(), changed: true }),
    resetPassword: vi.fn().mockResolvedValue(publicUser()),
  };
  const app = express();
  app.use(express.json());
  app.use(
    createSessionMiddleware({
      store: new session.MemoryStore(),
      secret: 'admin-users-test-secret-at-least-32-characters',
      cookieName,
      ttlHours: 1,
      secure: false,
    }),
  );
  app.get('/test/session/:id', (request_, response, next) => {
    request_.session.userId = request_.params.id;
    request_.session.authVersion = '1';
    request_.session.csrfToken = 'valid-csrf-token';
    request_.session.save((error) => {
      if (error) next(error);
      else response.status(204).end();
    });
  });
  app.use(
    '/api/v1/admin/usuarios',
    createAdminUsersRouter({
      service,
      authenticationRequired: requireAuthentication(authRepository, {
        cookieName,
        secureCookie: false,
      }),
      adminRequired: requireRole('admin'),
      cookieName,
      secureCookie: false,
    }),
  );
  app.use(errorHandler);
  return { app, service };
}

describe('admin user routes', () => {
  it('requires authentication and the current admin role', async () => {
    const context = buildRouterApp();
    await request(context.app).get('/api/v1/admin/usuarios').expect(401);

    const consultationAgent = request.agent(context.app);
    await consultationAgent.get('/test/session/2').expect(204);
    await consultationAgent.get('/api/v1/admin/usuarios').expect(403);
    expect(context.service.list).not.toHaveBeenCalled();
  });

  it('rejects unknown list parameters before calling the service', async () => {
    const context = buildRouterApp();
    const agent = request.agent(context.app);
    await agent.get('/test/session/1').expect(204);
    await agent.get('/api/v1/admin/usuarios?unknown=value').expect(400);
    expect(context.service.list).not.toHaveBeenCalled();
  });

  it('returns the documented list envelope without secrets', async () => {
    const context = buildRouterApp();
    const agent = request.agent(context.app);
    await agent.get('/test/session/1').expect(204);
    const response = await agent
      .get('/api/v1/admin/usuarios?page=1&limit=20&role=consulta&active=true')
      .expect(200);

    expect(response.body).toEqual({
      data: { users: [publicUser()] },
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/password|hash/i);
  });

  it('requires CSRF for mutations and creates a user with the mutation envelope', async () => {
    const context = buildRouterApp();
    const agent = request.agent(context.app);
    await agent.get('/test/session/1').expect(204);
    const body = {
      usuario: 'consulta',
      nombre: 'Cuenta de consulta',
      correo: 'consulta@example.test',
      rol: 'consulta',
      password: 'synthetic-password',
    };

    await agent.post('/api/v1/admin/usuarios').send(body).expect(403);
    const response = await agent
      .post('/api/v1/admin/usuarios')
      .set('X-CSRF-Token', 'valid-csrf-token')
      .send(body)
      .expect(201);

    expect(response.body).toEqual({ data: { user: publicUser() } });
  });

  it('validates patch bodies and forwards the authenticated actor ID', async () => {
    const context = buildRouterApp();
    const agent = request.agent(context.app);
    await agent.get('/test/session/1').expect(204);
    await agent
      .patch('/api/v1/admin/usuarios/2')
      .set('X-CSRF-Token', 'valid-csrf-token')
      .send({})
      .expect(400);
    await agent
      .patch('/api/v1/admin/usuarios/2')
      .set('X-CSRF-Token', 'valid-csrf-token')
      .send({ nombre: 'Nombre actualizado', activo: false })
      .expect(200);

    expect(context.service.update).toHaveBeenCalledWith({
      targetId: '2',
      actorId: '1',
      patch: { nombre: 'Nombre actualizado', activo: false },
    });
  });

  it('clears the browser cookie after resetting the current account password', async () => {
    const context = buildRouterApp();
    const agent = request.agent(context.app);
    await agent.get('/test/session/1').expect(204);
    const response = await agent
      .post('/api/v1/admin/usuarios/1/password')
      .set('X-CSRF-Token', 'valid-csrf-token')
      .send({ password: 'replacement-password' })
      .expect(200);

    expect(response.headers['set-cookie']?.[0]).toContain(`${cookieName}=;`);
    expect(context.service.resetPassword).toHaveBeenCalledWith({
      targetId: '1',
      password: 'replacement-password',
    });
  });

  it('sanitizes unexpected service failures', async () => {
    const context = buildRouterApp();
    const agent = request.agent(context.app);
    await agent.get('/test/session/1').expect(204);
    context.service.create.mockRejectedValueOnce(
      new Error('password=secret while running INSERT INTO usuarios'),
    );

    const response = await agent
      .post('/api/v1/admin/usuarios')
      .set('X-CSRF-Token', 'valid-csrf-token')
      .send({
        usuario: 'consulta',
        nombre: 'Cuenta de consulta',
        rol: 'consulta',
        password: 'synthetic-password',
      })
      .expect(500);

    expect(response.body).toEqual({
      error: { code: 'internal_error', message: 'Ocurrió un error interno.' },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/secret|insert|password/i);
  });
});
