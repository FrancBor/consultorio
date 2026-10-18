import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import argon2 from 'argon2';
import { config } from 'dotenv';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { createApp } from '../../src/app.js';
import { createDatabasePool } from '../../src/db/pool.js';
import { createReadinessCheck } from '../../src/db/readiness.js';
import { createLogger } from '../../src/lib/logger.js';
import { createAdminUsersModule } from '../../src/modules/admin-users/index.js';
import { createAdminAccount } from '../../src/modules/auth/admin.js';
import { createAuthModule } from '../../src/modules/auth/index.js';
import { createAuthRepository } from '../../src/modules/auth/repository.js';

config({ path: resolve('.env'), quiet: true });

const databaseName = `consultorio_auth_concurrency_${process.pid}_${Date.now()}`;
const sourceUrl = new URL(process.env.DATABASE_URL);
const maintenanceUrl = new URL(sourceUrl);
const testUrl = new URL(sourceUrl);
maintenanceUrl.pathname = '/postgres';
testUrl.pathname = `/${databaseName}`;

const maintenance = new pg.Client({ connectionString: maintenanceUrl.toString() });
const passwords = {
  admin: randomBytes(24).toString('base64url'),
  raceOld: randomBytes(24).toString('base64url'),
  raceNew: randomBytes(24).toString('base64url'),
  target: randomBytes(24).toString('base64url'),
  targetReset: randomBytes(24).toString('base64url'),
};
const environment = {
  NODE_ENV: 'test',
  DATABASE_URL: testUrl.toString(),
  SESSION_SECRET: randomBytes(32).toString('base64url'),
  SESSION_COOKIE_NAME: 'consultorio.sid',
  SESSION_TTL_HOURS: 1,
  TRUST_PROXY: false,
  LOG_LEVEL: 'silent',
  PORT: 0,
};

let pool;
let auth;
let httpServer;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function migrate(direction, count) {
  await runner({
    databaseUrl: testUrl.toString(),
    dir: resolve('db', 'migrations'),
    direction,
    count,
    migrationsTable: 'schema_migrations',
    migrationLoaderStrategies: [{ extensions: ['.sql'], loader: 'sql' }],
    log: () => {},
  });
}

async function validateMigrationCycle() {
  const client = new pg.Client({ connectionString: testUrl.toString() });
  await client.connect();

  try {
    const up = await client.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'usuarios'
             AND column_name = 'auth_version'
             AND data_type = 'bigint'
             AND is_nullable = 'NO'
         ) AS column_ok,
         EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'chk_usuarios_auth_version_positivo'
         ) AS constraint_ok,
         (SELECT count(*)::int FROM schema_migrations) AS migrations`,
    );
    assert(up.rows[0].column_ok && up.rows[0].constraint_ok, 'Migration 003 up is incomplete.');
    assert(up.rows[0].migrations === 4, 'Expected four applied migrations.');
  } finally {
    await client.end();
  }

  await migrate('down', 2);

  const downClient = new pg.Client({ connectionString: testUrl.toString() });
  await downClient.connect();
  try {
    const down = await downClient.query(
      `SELECT
         NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'usuarios'
             AND column_name = 'auth_version'
         ) AS column_removed,
         to_regclass('public.usuarios') IS NOT NULL AS users_preserved,
         to_regclass('public.sesiones_http') IS NOT NULL AS sessions_preserved,
         (SELECT count(*)::int FROM schema_migrations) AS migrations`,
    );
    assert(down.rows[0].column_removed, 'Migration 003 down did not remove its column.');
    assert(down.rows[0].users_preserved && down.rows[0].sessions_preserved, 'Migration 003 down removed unrelated objects.');
    assert(down.rows[0].migrations === 2, 'Migration 003 down changed unexpected history.');
  } finally {
    await downClient.end();
  }

  await migrate('up', Number.POSITIVE_INFINITY);
}

function jar() {
  return { cookie: null };
}

async function http(baseUrl, cookieJar, path, { method = 'GET', body, csrf } = {}) {
  const headers = {};
  if (cookieJar.cookie) headers.Cookie = cookieJar.cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookieJar.cookie = setCookie.split(';')[0];
  const text = await response.text();
  return { response, payload: text ? JSON.parse(text) : null };
}

async function mutate(baseUrl, cookieJar, path, method, body) {
  const csrf = await http(baseUrl, cookieJar, '/api/v1/auth/csrf');
  assert(csrf.response.status === 200, 'CSRF acquisition failed.');
  return http(baseUrl, cookieJar, path, {
    method,
    body,
    csrf: csrf.payload.csrfToken,
  });
}

async function login(baseUrl, cookieJar, username, password) {
  return mutate(baseUrl, cookieJar, '/api/v1/auth/login', 'POST', {
    usuario: username,
    password,
  });
}

async function createUser(baseUrl, adminJar, input) {
  const result = await mutate(baseUrl, adminJar, '/api/v1/admin/usuarios', 'POST', input);
  assert(result.response.status === 201, `Could not create ${input.usuario}.`);
  assert(!/password|hash/i.test(JSON.stringify(result.payload)), 'A create response leaked secrets.');
  return result.payload.data.user;
}

async function authVersion(userId) {
  const result = await pool.query('SELECT auth_version::text AS value FROM usuarios WHERE id = $1', [userId]);
  return result.rows[0].value;
}

async function sessionCount(userId) {
  const result = await pool.query(
    `SELECT count(*)::int AS total
     FROM sesiones_http
     WHERE sess ->> 'userId' = $1`,
    [String(userId)],
  );
  return result.rows[0].total;
}

async function waitForBlockedLogin(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT count(*)::int AS total
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND wait_event_type = 'Lock'
         AND query LIKE '%SET ultimo_acceso_en = CURRENT_TIMESTAMP%'`,
    );
    if (result.rows[0].total > 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error('Timed out waiting for the login compare-and-set lock.');
}

try {
  await maintenance.connect();
  await maintenance.query(`CREATE DATABASE ${databaseName}`);
  await migrate('up', Number.POSITIVE_INFINITY);
  await validateMigrationCycle();

  pool = createDatabasePool(testUrl.toString());
  await createAdminAccount({
    repository: createAuthRepository(pool),
    username: 'integration-admin',
    name: 'Integration administrator',
    password: passwords.admin,
  });

  const logger = createLogger({ level: 'silent', nodeEnv: 'test' });
  auth = createAuthModule({ pool, environment, logger });
  const app = createApp({
    readinessCheck: createReadinessCheck(pool),
    logger,
    auth,
    adminUsers: createAdminUsersModule({ pool, environment }),
  });
  httpServer = app.listen(0, '127.0.0.1');
  await new Promise((resolveListen, rejectListen) => {
    httpServer.once('listening', resolveListen);
    httpServer.once('error', rejectListen);
  });
  const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  const adminJar = jar();
  const adminLogin = await login(baseUrl, adminJar, 'integration-admin', passwords.admin);
  assert(adminLogin.response.status === 200, 'Administrator login failed.');

  const raceUser = await createUser(baseUrl, adminJar, {
    usuario: 'race-user',
    nombre: 'Race user',
    rol: 'consulta',
    password: passwords.raceOld,
  });
  const raceHash = await argon2.hash(passwords.raceNew, { type: argon2.argon2id });
  const blocker = await pool.connect();
  let blockerOpen = false;
  try {
    await blocker.query('BEGIN');
    blockerOpen = true;
    await blocker.query('SELECT id FROM usuarios WHERE id = $1 FOR UPDATE', [raceUser.id]);

    const staleLoginJar = jar();
    const staleLoginPromise = login(baseUrl, staleLoginJar, 'race-user', passwords.raceOld);
    await waitForBlockedLogin();
    await blocker.query(
      `UPDATE usuarios
       SET password_hash = $2,
           auth_version = auth_version + 1,
           actualizado_en = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [raceUser.id, raceHash],
    );
    await blocker.query(`DELETE FROM sesiones_http WHERE sess ->> 'userId' = $1`, [raceUser.id]);
    await blocker.query('COMMIT');
    blockerOpen = false;

    const staleLogin = await staleLoginPromise;
    assert(staleLogin.response.status === 401, 'Old-password login survived a concurrent reset.');
    assert((await http(baseUrl, staleLoginJar, '/api/v1/auth/me')).response.status === 401, 'Concurrent stale login created a usable session.');
  } finally {
    if (blockerOpen) await blocker.query('ROLLBACK');
    blocker.release();
  }

  const target = await createUser(baseUrl, adminJar, {
    usuario: 'session-target',
    nombre: 'Session target',
    correo: 'session-target@example.test',
    rol: 'consulta',
    password: passwords.target,
  });
  const firstSession = jar();
  const secondSession = jar();
  const [firstLogin, secondLogin] = await Promise.all([
    login(baseUrl, firstSession, 'session-target', passwords.target),
    login(baseUrl, secondSession, 'session-target', passwords.target),
  ]);
  assert(firstLogin.response.status === 200 && secondLogin.response.status === 200, 'Concurrent logins did not both succeed.');
  assert((await http(baseUrl, firstSession, '/api/v1/auth/me')).response.status === 200, 'First concurrent session is invalid.');
  assert((await http(baseUrl, secondSession, '/api/v1/auth/me')).response.status === 200, 'Second concurrent session is invalid.');
  assert(await sessionCount(target.id) === 2, 'Concurrent logins did not persist two sessions.');

  const versionBeforeName = await authVersion(target.id);
  const nameChange = await mutate(
    baseUrl,
    adminJar,
    `/api/v1/admin/usuarios/${target.id}`,
    'PATCH',
    { nombre: 'Renamed session target' },
  );
  assert(nameChange.response.status === 200, 'Name-only update failed.');
  assert((await authVersion(target.id)) === versionBeforeName, 'Name-only update changed auth_version.');
  assert((await http(baseUrl, firstSession, '/api/v1/auth/me')).response.status === 200, 'Name-only update invalidated a session.');
  assert((await http(baseUrl, secondSession, '/api/v1/auth/me')).response.status === 200, 'Name-only update invalidated the second session.');

  const reset = await mutate(
    baseUrl,
    adminJar,
    `/api/v1/admin/usuarios/${target.id}/password`,
    'POST',
    { password: passwords.targetReset },
  );
  assert(reset.response.status === 200, 'Password reset failed.');
  assert(BigInt(await authVersion(target.id)) === BigInt(versionBeforeName) + 1n, 'Password reset did not increment auth_version exactly once.');
  assert(await sessionCount(target.id) === 0, 'Password reset did not delete every target session.');
  assert((await http(baseUrl, firstSession, '/api/v1/auth/me')).response.status === 401, 'Password reset left the first session valid.');
  assert((await http(baseUrl, secondSession, '/api/v1/auth/me')).response.status === 401, 'Password reset left the second session valid.');

  const roleSession = jar();
  assert((await login(baseUrl, roleSession, 'session-target', passwords.targetReset)).response.status === 200, 'Login after reset failed.');
  const versionBeforeRole = await authVersion(target.id);
  const roleChange = await mutate(
    baseUrl,
    adminJar,
    `/api/v1/admin/usuarios/${target.id}`,
    'PATCH',
    { rol: 'admin' },
  );
  assert(roleChange.response.status === 200, 'Role change failed.');
  assert(BigInt(await authVersion(target.id)) === BigInt(versionBeforeRole) + 1n, 'Role change did not increment auth_version.');
  assert((await http(baseUrl, roleSession, '/api/v1/auth/me')).response.status === 401, 'Role change left a session valid.');

  const activeSession = jar();
  assert((await login(baseUrl, activeSession, 'session-target', passwords.targetReset)).response.status === 200, 'Login before deactivation failed.');
  const versionBeforeActive = await authVersion(target.id);
  const deactivation = await mutate(
    baseUrl,
    adminJar,
    `/api/v1/admin/usuarios/${target.id}`,
    'PATCH',
    { activo: false },
  );
  assert(deactivation.response.status === 200, 'Deactivation failed.');
  assert(BigInt(await authVersion(target.id)) === BigInt(versionBeforeActive) + 1n, 'Active-state change did not increment auth_version.');
  assert((await http(baseUrl, activeSession, '/api/v1/auth/me')).response.status === 401, 'Deactivation left a session valid.');

  const list = await http(
    baseUrl,
    adminJar,
    '/api/v1/admin/usuarios?search=session-target&active=false',
  );
  assert(list.response.status === 200 && list.payload.data.users.length === 1, 'Filtered admin listing failed.');
  assert(!/password|hash/i.test(JSON.stringify(list.payload)), 'Admin listing leaked a secret.');

  const reactivation = await mutate(
    baseUrl,
    adminJar,
    `/api/v1/admin/usuarios/${target.id}`,
    'PATCH',
    { activo: true, rol: 'consulta' },
  );
  assert(
    reactivation.response.status === 200 && reactivation.payload.data.user.activo,
    'Reactivation failed.',
  );

  console.log('PostgreSQL auth concurrency integration passed: migrations up/down, CAS race, concurrent sessions, selective invalidation, and cleanup.');
} finally {
  if (httpServer) await new Promise((resolveClose) => httpServer.close(resolveClose));
  if (auth) await auth.sessionStore.close();
  if (pool) await pool.end();
  if (maintenance._connected) {
    await maintenance.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await maintenance.end();
  }
}
