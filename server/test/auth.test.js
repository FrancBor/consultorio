import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import { requireRole } from '../src/middleware/authentication.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createLoginRateLimiter } from '../src/modules/auth/rate-limit.js';
import { createAuthRouter } from '../src/modules/auth/routes.js';
import { createAuthService } from '../src/modules/auth/service.js';
import { createSessionMiddleware } from '../src/modules/auth/session.js';

const cookieName = 'consultorio.sid';
const sessionSecret = 'test-session-secret-at-least-32-characters';

function csrfFrom(response) {
  return response.body.csrfToken;
}

function sessionCookieFrom(response) {
  return response.headers['set-cookie']?.[0].split(';')[0];
}

function allSessionsFrom(store) {
  return new Promise((resolve, reject) => {
    store.all((error, sessions) => (error ? reject(error) : resolve(sessions)));
  });
}

function setSession(store, sessionId, value) {
  return new Promise((resolve, reject) => {
    store.set(sessionId, value, (error) => (error ? reject(error) : resolve()));
  });
}

function buildAuthApp({ loginLimiter = (_request, _response, next) => next() } = {}) {
  const account = {
    id: '1',
    usuario: 'admin',
    nombre_mostrar: 'Administrador',
    rol_codigo: 'admin',
    password_hash: 'valid-hash',
    activo: true,
    rol_activo: true,
    auth_version: '1',
  };
  const repository = {
    findByUsername: vi.fn(async (username) =>
      username.toLowerCase() === account.usuario.toLowerCase() ? { ...account } : null,
    ),
    findActiveById: vi.fn(async (id) =>
      String(id) === account.id && account.activo && account.rol_activo
        ? { ...account }
        : null,
    ),
    finalizeSuccessfulLogin: vi.fn(async ({ userId, authVersion, passwordHash }) =>
      String(userId) === account.id &&
      authVersion === account.auth_version &&
      passwordHash === account.password_hash &&
      account.activo &&
      account.rol_activo
        ? account.auth_version
        : undefined,
    ),
  };
  const authService = createAuthService({
    repository,
    verifyPassword: vi.fn(async (hash, password) =>
      hash === 'valid-hash' && password === 'correct-password',
    ),
    fallbackHashPromise: Promise.resolve('fallback-hash'),
  });
  const sessionStore = new session.MemoryStore();
  const sessionMiddleware = createSessionMiddleware({
    store: sessionStore,
    secret: sessionSecret,
    cookieName,
    ttlHours: 1,
    secure: false,
  });
  const router = createAuthRouter({
    authService,
    repository,
    loginLimiter,
    cookieName,
    secureCookie: false,
  });
  const app = createApp({
    readinessCheck: vi.fn().mockResolvedValue(undefined),
    logger: createLogger({ level: 'silent', nodeEnv: 'test' }),
    auth: { router, sessionMiddleware },
  });

  return { app, account, repository, sessionStore };
}

describe('authentication HTTP flow', () => {
  let context;

  beforeEach(() => {
    context = buildAuthApp();
  });

  it('creates an anonymous session and rotates its CSRF token', async () => {
    const agent = request.agent(context.app);
    const first = await agent.get('/api/v1/auth/csrf').expect(200);
    const second = await agent.get('/api/v1/auth/csrf').expect(200);

    expect(csrfFrom(first)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(csrfFrom(second)).not.toBe(csrfFrom(first));
    expect(first.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(first.headers['set-cookie']?.[0]).toContain('SameSite=Lax');
  });

  it('requires CSRF for login', async () => {
    const response = await request(context.app)
      .post('/api/v1/auth/login')
      .send({ usuario: 'admin', password: 'correct-password' })
      .expect(403);

    expect(response.body.error.code).toBe('invalid_csrf');
  });

  it('returns the same generic error for wrong credentials and inactive accounts', async () => {
    const attempt = async (agent, password) => {
      const csrfResponse = await agent.get('/api/v1/auth/csrf');
      return agent
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', csrfFrom(csrfResponse))
        .send({ usuario: 'admin', password });
    };
    const wrongPassword = await attempt(request.agent(context.app), 'wrong-password');
    context.account.activo = false;
    const inactive = await attempt(request.agent(context.app), 'correct-password');

    expect(wrongPassword.status).toBe(401);
    expect(inactive.status).toBe(401);
    expect(inactive.body).toEqual(wrongPassword.body);
    expect(wrongPassword.body.error.message).toBe('Usuario o contraseña incorrectos.');
  });

  it('regenerates the session, returns a new CSRF token, and records last access', async () => {
    const agent = request.agent(context.app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf');
    const anonymousCookie = sessionCookieFrom(csrfResponse);
    const response = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfFrom(csrfResponse))
      .send({ usuario: 'ADMIN', password: 'correct-password' })
      .expect(200);

    expect(sessionCookieFrom(response)).not.toBe(anonymousCookie);
    expect(response.body.csrfToken).not.toBe(csrfFrom(csrfResponse));
    expect(response.body.user).toEqual({
      id: '1',
      usuario: 'admin',
      nombre: 'Administrador',
      rol: 'admin',
    });
    expect(context.repository.finalizeSuccessfulLogin).toHaveBeenCalledWith({
      userId: '1',
      authVersion: '1',
      passwordHash: 'valid-hash',
    });
  });

  it('does not authenticate the session when login finalization fails', async () => {
    const agent = request.agent(context.app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf');
    context.repository.finalizeSuccessfulLogin.mockRejectedValueOnce(
      new Error('last access unavailable'),
    );

    await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfFrom(csrfResponse))
      .send({ usuario: 'admin', password: 'correct-password' })
      .expect(500);

    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('returns generic invalid credentials when the login compare-and-set loses a race', async () => {
    const agent = request.agent(context.app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf');
    context.repository.finalizeSuccessfulLogin.mockResolvedValueOnce(undefined);

    const response = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfFrom(csrfResponse))
      .send({ usuario: 'admin', password: 'correct-password' })
      .expect(401);

    expect(response.body.error.code).toBe('invalid_credentials');
    expect(sessionCookieFrom(response)).toBeUndefined();
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('keeps two independently created sessions valid', async () => {
    const first = request.agent(context.app);
    const second = request.agent(context.app);
    const [firstCsrf, secondCsrf] = await Promise.all([
      first.get('/api/v1/auth/csrf'),
      second.get('/api/v1/auth/csrf'),
    ]);

    await Promise.all([
      first
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', csrfFrom(firstCsrf))
        .send({ usuario: 'admin', password: 'correct-password' })
        .expect(200),
      second
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', csrfFrom(secondCsrf))
        .send({ usuario: 'admin', password: 'correct-password' })
        .expect(200),
    ]);

    await first.get('/api/v1/auth/me').expect(200);
    await second.get('/api/v1/auth/me').expect(200);
    expect(Object.keys(await allSessionsFrom(context.sessionStore))).toHaveLength(2);
  });

  it('destroys the regenerated session when persisting it fails', async () => {
    const agent = request.agent(context.app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf');
    vi.spyOn(context.sessionStore, 'set').mockImplementationOnce(
      (_sessionId, _session, callback) => callback(new Error('session write failed')),
    );

    const login = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfFrom(csrfResponse))
      .send({ usuario: 'admin', password: 'correct-password' })
      .expect(500);

    expect(login.headers['set-cookie']?.[0]).toContain(`${cookieName}=;`);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('returns 401 without a session and the current active user after login', async () => {
    await request(context.app).get('/api/v1/auth/me').expect(401);
    const agent = request.agent(context.app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf');
    await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfFrom(csrfResponse))
      .send({ usuario: 'admin', password: 'correct-password' })
      .expect(200);

    const response = await agent.get('/api/v1/auth/me').expect(200);
    expect(response.body.user.rol).toBe('admin');
  });

  it('reflects account deactivation and role changes on the next request', async () => {
    const agent = request.agent(context.app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf');
    await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfFrom(csrfResponse))
      .send({ usuario: 'admin', password: 'correct-password' });

    context.account.rol_codigo = 'consulta';
    const changedRole = await agent.get('/api/v1/auth/me').expect(200);
    expect(changedRole.body.user.rol).toBe('consulta');

    context.account.activo = false;
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('rejects a session after the account authentication version changes', async () => {
    const agent = request.agent(context.app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf');
    await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfFrom(csrfResponse))
      .send({ usuario: 'admin', password: 'correct-password' })
      .expect(200);

    context.account.auth_version = '2';
    const response = await agent.get('/api/v1/auth/me').expect(401);

    expect(response.headers['set-cookie']?.[0]).toContain(`${cookieName}=;`);
    expect(Object.keys(await allSessionsFrom(context.sessionStore))).toHaveLength(0);
  });

  it('rejects and destroys a legacy session without authVersion', async () => {
    const agent = request.agent(context.app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf');
    await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfFrom(csrfResponse))
      .send({ usuario: 'admin', password: 'correct-password' })
      .expect(200);
    const sessions = await allSessionsFrom(context.sessionStore);
    const [sessionId, storedSession] = Object.entries(sessions)[0];
    delete storedSession.authVersion;
    await setSession(context.sessionStore, sessionId, storedSession);

    const response = await agent.get('/api/v1/auth/me').expect(401);

    expect(response.headers['set-cookie']?.[0]).toContain(`${cookieName}=;`);
    expect(Object.keys(await allSessionsFrom(context.sessionStore))).toHaveLength(0);
  });

  it('destroys an inactive account session so reactivation cannot revive it', async () => {
    const agent = request.agent(context.app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf');
    const login = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfFrom(csrfResponse))
      .send({ usuario: 'admin', password: 'correct-password' })
      .expect(200);
    const authenticatedCookie = sessionCookieFrom(login);

    context.account.activo = false;
    const inactive = await agent.get('/api/v1/auth/me').expect(401);

    expect(inactive.headers['set-cookie']?.[0]).toContain(`${cookieName}=;`);
    expect(Object.keys(await allSessionsFrom(context.sessionStore))).toHaveLength(0);

    context.account.activo = true;
    await request(context.app)
      .get('/api/v1/auth/me')
      .set('Cookie', authenticatedCookie)
      .expect(401);
  });

  it('clears the cookie and denies identity when inactive-session destruction fails', async () => {
    const agent = request.agent(context.app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf');
    await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfFrom(csrfResponse))
      .send({ usuario: 'admin', password: 'correct-password' })
      .expect(200);
    const destroy = vi
      .spyOn(context.sessionStore, 'destroy')
      .mockImplementationOnce((_sessionId, callback) => {
        callback(new Error('session destroy failed'));
      });

    context.account.activo = false;
    const response = await agent.get('/api/v1/auth/me').expect(500);

    expect(destroy).toHaveBeenCalledOnce();
    expect(response.headers['set-cookie']?.[0]).toContain(`${cookieName}=;`);
    expect(response.body).toEqual({
      error: {
        code: 'internal_error',
        message: 'Ocurrió un error interno.',
      },
    });
    expect(response.body.user).toBeUndefined();

    context.account.activo = true;
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('rejects an incorrect CSRF token', async () => {
    const agent = request.agent(context.app);
    await agent.get('/api/v1/auth/csrf');

    const response = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'incorrect-token')
      .send({ usuario: 'admin', password: 'correct-password' })
      .expect(403);

    expect(response.body.error.code).toBe('invalid_csrf');
  });

  it('requires CSRF for logout, destroys the session, and clears the cookie', async () => {
    const agent = request.agent(context.app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf');
    const login = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfFrom(csrfResponse))
      .send({ usuario: 'admin', password: 'correct-password' });

    await agent.post('/api/v1/auth/logout').expect(403);
    const logout = await agent
      .post('/api/v1/auth/logout')
      .set('X-CSRF-Token', login.body.csrfToken)
      .expect(204);

    expect(logout.headers['set-cookie']?.[0]).toContain(`${cookieName}=;`);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('allows an inactive account to destroy its session without letting it revive', async () => {
    const agent = request.agent(context.app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf');
    const login = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfFrom(csrfResponse))
      .send({ usuario: 'admin', password: 'correct-password' })
      .expect(200);

    context.account.activo = false;
    const logout = await agent
      .post('/api/v1/auth/logout')
      .set('X-CSRF-Token', login.body.csrfToken)
      .expect(204);
    expect(logout.headers['set-cookie']?.[0]).toContain(`${cookieName}=;`);

    context.account.activo = true;
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('returns 401 when an anonymous session attempts to log out', async () => {
    const agent = request.agent(context.app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf');

    await agent
      .post('/api/v1/auth/logout')
      .set('X-CSRF-Token', csrfFrom(csrfResponse))
      .expect(401);
  });

  it('returns 429 deterministically when the login limit is exceeded', async () => {
    const limited = buildAuthApp({
      loginLimiter: createLoginRateLimiter({ windowMs: 60_000, limit: 1 }),
    });
    const agent = request.agent(limited.app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf');

    await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfFrom(csrfResponse))
      .send({ usuario: 'admin', password: 'wrong-password' })
      .expect(401);
    const response = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfFrom(csrfResponse))
      .send({ usuario: 'admin', password: 'wrong-password' })
      .expect(429);

    expect(response.body.error.code).toBe('rate_limit_exceeded');
  });
});

describe('role middleware', () => {
  it('allows the required role and rejects another role', async () => {
    const app = express();
    app.get(
      '/allowed',
      (request_, _response, next) => {
        request_.authUser = { rol: 'admin' };
        next();
      },
      requireRole('admin'),
      (_request, response) => response.status(204).end(),
    );
    app.get(
      '/forbidden',
      (request_, _response, next) => {
        request_.authUser = { rol: 'consulta' };
        next();
      },
      requireRole('admin'),
      (_request, response) => response.status(204).end(),
    );
    app.use(errorHandler);

    await request(app).get('/allowed').expect(204);
    const forbidden = await request(app).get('/forbidden').expect(403);
    expect(forbidden.body.error.code).toBe('forbidden');
  });
});
