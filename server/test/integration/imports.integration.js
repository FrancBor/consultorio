import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { createApp } from '../../src/app.js';
import { createDatabasePool } from '../../src/db/pool.js';
import { createReadinessCheck } from '../../src/db/readiness.js';
import { createLogger } from '../../src/lib/logger.js';
import { createAuthModule } from '../../src/modules/auth/index.js';
import { createAuthRepository } from '../../src/modules/auth/repository.js';
import { createAdminAccount } from '../../src/modules/auth/admin.js';
import { createImportsModule } from '../../src/modules/imports/index.js';
import { IMPORT_SOURCE } from '../../src/modules/imports/parser.js';

config({ path: resolve('.env'), quiet: true });

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const databaseName = `consultorio_imports_${process.pid}_${Date.now()}`;
const sourceUrl = new URL(process.env.DATABASE_URL);
const maintenanceUrl = new URL(sourceUrl);
const testUrl = new URL(sourceUrl);
maintenanceUrl.pathname = '/postgres';
testUrl.pathname = `/${databaseName}`;

const maintenance = new pg.Client({ connectionString: maintenanceUrl.toString() });
const password = randomBytes(24).toString('base64url');
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
             AND table_name = 'lotes_importacion'
             AND column_name = 'cantidad_actualizados'
             AND data_type = 'integer'
             AND is_nullable = 'NO'
         ) AS column_ok,
         to_regclass('public.uq_lotes_importacion_fuente_hash') IS NOT NULL AS index_ok,
         (SELECT count(*)::int FROM schema_migrations) AS migrations`,
    );
    assert(up.rows[0].column_ok && up.rows[0].index_ok, 'Migration 004 up is incomplete.');
    assert(up.rows[0].migrations === 4, 'Expected four applied migrations.');
  } finally {
    await client.end();
  }

  await migrate('down', 1);
  const downClient = new pg.Client({ connectionString: testUrl.toString() });
  await downClient.connect();
  try {
    const down = await downClient.query(
      `SELECT
         NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'lotes_importacion'
             AND column_name = 'cantidad_actualizados'
         ) AS column_removed,
         to_regclass('public.uq_lotes_importacion_fuente_hash') IS NULL AS index_removed,
         to_regclass('public.solicitudes_atencion') IS NOT NULL AS facts_preserved,
         (SELECT count(*)::int FROM schema_migrations) AS migrations`,
    );
    assert(
      down.rows[0].column_removed && down.rows[0].index_removed,
      'Migration 004 down did not remove its objects.',
    );
    assert(down.rows[0].facts_preserved, 'Migration 004 down removed unrelated facts.');
    assert(down.rows[0].migrations === 3, 'Migration 004 down changed unexpected history.');
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
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body:
      body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookieJar.cookie = setCookie.split(';')[0];
  const text = await response.text();
  return { response, payload: text ? JSON.parse(text) : null };
}

async function csrf(baseUrl, cookieJar) {
  const result = await http(baseUrl, cookieJar, '/api/v1/auth/csrf');
  assert(result.response.status === 200, 'CSRF acquisition failed.');
  return result.payload.csrfToken;
}

async function login(baseUrl, cookieJar) {
  return http(baseUrl, cookieJar, '/api/v1/auth/login', {
    method: 'POST',
    csrf: await csrf(baseUrl, cookieJar),
    body: { usuario: 'integration-admin', password },
  });
}

function record(key, overrides = {}) {
  return {
    clave_origen: key,
    tipo_atencion_codigo: 'medicina_general',
    estado_solicitud_codigo: 'cerrada',
    solicitada_en: '2026-10-01T09:00:00-03:00',
    cerrada_en: '2026-10-02T10:30:00-03:00',
    estado_cita_codigo: 'atendida',
    inicio_agendado_en: '2026-10-02T10:00:00-03:00',
    llegada_en: '2026-10-02T09:50:00-03:00',
    inicio_atencion_en: '2026-10-02T10:05:00-03:00',
    fin_atencion_en: '2026-10-02T10:30:00-03:00',
    ...overrides,
  };
}

function jsonForm(records, filename) {
  const form = new FormData();
  form.append(
    'archivo',
    new Blob([JSON.stringify(records)], { type: 'application/json' }),
    filename,
  );
  return form;
}

async function upload(baseUrl, cookieJar, records, filename = 'datos.json') {
  return http(baseUrl, cookieJar, '/api/v1/admin/importaciones', {
    method: 'POST',
    csrf: await csrf(baseUrl, cookieJar),
    body: jsonForm(records, filename),
  });
}

async function factCounts() {
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM lotes_importacion WHERE sistema_origen = $1) AS batches,
       (SELECT count(*)::int FROM solicitudes_atencion WHERE sistema_origen = $1) AS requests,
       (SELECT count(*)::int FROM citas WHERE sistema_origen = $1) AS appointments,
       (SELECT count(*)::int FROM atenciones_realizadas WHERE sistema_origen = $1) AS attentions`,
    [IMPORT_SOURCE],
  );
  return result.rows[0];
}

async function isolationSnapshot(key) {
  const result = await pool.query(
    `SELECT
       s.lote_importacion_id::text AS request_batch,
       s.estado_solicitud_codigo AS request_status,
       c.lote_importacion_id::text AS appointment_batch,
       c.estado_cita_codigo AS appointment_status,
       a.id::text AS attention_id,
       a.sistema_origen AS attention_source,
       a.clave_origen AS attention_key,
       a.lote_importacion_id::text AS attention_batch,
       (SELECT count(*)::int FROM lotes_importacion WHERE sistema_origen = $1) AS manual_batches
     FROM solicitudes_atencion AS s
     JOIN citas AS c ON c.solicitud_atencion_id = s.id
     LEFT JOIN atenciones_realizadas AS a ON a.cita_id = c.id
     WHERE s.sistema_origen = $1 AND s.clave_origen = $2`,
    [IMPORT_SOURCE, key],
  );
  return result.rows[0];
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
    password,
  });

  const logger = createLogger({ level: 'silent', nodeEnv: 'test' });
  auth = createAuthModule({ pool, environment, logger });
  const app = createApp({
    readinessCheck: createReadinessCheck(pool),
    logger,
    auth,
    imports: createImportsModule({ pool, environment }),
  });
  httpServer = app.listen(0, '127.0.0.1');
  await new Promise((resolveListen, rejectListen) => {
    httpServer.once('listening', resolveListen);
    httpServer.once('error', rejectListen);
  });
  const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  const adminJar = jar();
  assert((await login(baseUrl, adminJar)).response.status === 200, 'Administrator login failed.');

  const unsupported = await http(baseUrl, adminJar, '/api/v1/admin/importaciones', {
    method: 'POST',
    csrf: await csrf(baseUrl, adminJar),
    body: (() => {
      const form = new FormData();
      form.append('archivo', new Blob(['unsupported'], { type: 'text/plain' }), 'datos.txt');
      return form;
    })(),
  });
  assert(unsupported.response.status === 415, 'Unsupported media did not return 415.');

  const first = await upload(baseUrl, adminJar, [record('manual-0001')], 'primero.json');
  assert(first.response.status === 201, 'First import did not return 201.');
  assert(first.payload.data.importacion.cantidad_insertados === 1, 'First row was not inserted.');
  assert(
    JSON.stringify(await factCounts()) ===
      JSON.stringify({ batches: 1, requests: 1, appointments: 1, attentions: 1 }),
    'First import did not create exactly one linked fact set.',
  );
  const firstId = first.payload.data.importacion.id;
  const detail = await http(
    baseUrl,
    adminJar,
    `/api/v1/admin/importaciones/${firstId}`,
  );
  assert(detail.response.status === 200, 'Manual import detail failed.');
  assert(detail.payload.data.importacion.id === firstId, 'Detail returned the wrong batch.');
  assert(
    !/hash_contenido|clave_origen|ruta/i.test(JSON.stringify(detail.payload)),
    'Detail leaked internal identifiers or paths.',
  );
  assert(
    (await http(baseUrl, adminJar, '/api/v1/admin/importaciones/999999999')).response.status === 404,
    'Missing import detail did not return 404.',
  );

  const repeated = await upload(baseUrl, adminJar, [record('manual-0001')], 'primero.json');
  assert(repeated.response.status === 200 && repeated.payload.meta.repetida, 'Exact retry was not idempotent.');

  const concurrentRows = [record('manual-0002')];
  const concurrentToken = await csrf(baseUrl, adminJar);
  const concurrent = await Promise.all([
    http(baseUrl, adminJar, '/api/v1/admin/importaciones', {
      method: 'POST',
      csrf: concurrentToken,
      body: jsonForm(concurrentRows, 'concurrente.json'),
    }),
    http(baseUrl, adminJar, '/api/v1/admin/importaciones', {
      method: 'POST',
      csrf: concurrentToken,
      body: jsonForm(concurrentRows, 'concurrente.json'),
    }),
  ]);
  assert(
    concurrent.map((result) => result.response.status).sort().join(',') === '200,201',
    `Concurrent duplicate did not produce one creation and one idempotent response: ${concurrent
      .map((result) => `${result.response.status}:${JSON.stringify(result.payload)}`)
      .join(' | ')}`,
  );

  const updated = await upload(
    baseUrl,
    adminJar,
    [
      record('manual-0001', {
        estado_cita_codigo: 'inasistencia',
        llegada_en: undefined,
        inicio_atencion_en: undefined,
        fin_atencion_en: undefined,
      }),
    ],
    'actualizado.json',
  );
  assert(updated.response.status === 201, 'Changed content did not create an audit batch.');
  assert(updated.payload.data.importacion.cantidad_actualizados === 1, 'Changed row was not classified as updated.');
  const afterUpdate = await factCounts();
  assert(
    afterUpdate.batches === 3 &&
      afterUpdate.requests === 2 &&
      afterUpdate.appointments === 2 &&
      afterUpdate.attentions === 1,
    'Update did not preserve cardinality or remove the obsolete attention.',
  );

  const manualAppointment = await pool.query(
    `SELECT id
     FROM citas
     WHERE sistema_origen = $1 AND clave_origen = $2`,
    [IMPORT_SOURCE, 'manual-0002'],
  );
  const externalBatch = await pool.query(
    `INSERT INTO lotes_importacion (
       sistema_origen, clave_origen, version_contrato, formato, nombre_archivo,
       hash_contenido_sha256, cantidad_registros, cantidad_insertados,
       cantidad_actualizados, cantidad_omitidos
     )
     VALUES ('fuente_externa_regresion', 'lote-externo', '1.0', 'json',
             'externo.json', $1, 1, 1, 0, 0)
     RETURNING id`,
    ['e'.repeat(64)],
  );
  await pool.query(
    `DELETE FROM atenciones_realizadas
     WHERE sistema_origen = $1 AND cita_id = $2`,
    [IMPORT_SOURCE, manualAppointment.rows[0].id],
  );
  await pool.query(
    `INSERT INTO atenciones_realizadas (
       lote_importacion_id, sistema_origen, clave_origen, cita_id,
       inicio_atencion_en, fin_atencion_en, duracion_espera_reportada_minutos
     )
     VALUES ($1, 'fuente_externa_regresion', 'manual-0002', $2,
             '2026-10-02T13:05:00Z', '2026-10-02T13:30:00Z', 15)`,
    [externalBatch.rows[0].id, manualAppointment.rows[0].id],
  );
  const beforeIsolation = await isolationSnapshot('manual-0002');
  const isolated = await upload(
    baseUrl,
    adminJar,
    [
      record('manual-0002', {
        estado_cita_codigo: 'inasistencia',
        llegada_en: undefined,
        inicio_atencion_en: undefined,
        fin_atencion_en: undefined,
      }),
    ],
    'aislamiento.json',
  );
  assert(isolated.response.status === 409, 'Cross-source linked attention was not rejected.');
  const afterIsolation = await isolationSnapshot('manual-0002');
  assert(
    JSON.stringify(afterIsolation) === JSON.stringify(beforeIsolation),
    'Cross-source rejection changed a batch, request, appointment, or attention.',
  );
  assert(
    afterIsolation.attention_source === 'fuente_externa_regresion',
    'Cross-source rejection did not preserve the external attention.',
  );
  assert(
    (
      await http(
        baseUrl,
        adminJar,
        `/api/v1/admin/importaciones/${externalBatch.rows[0].id}`,
      )
    ).response.status === 404,
    'Detail endpoint exposed a non-manual batch.',
  );

  const beforeInvalid = await factCounts();
  const invalid = await upload(
    baseUrl,
    adminJar,
    [record('manual-invalid', { tipo_atencion_codigo: 'contenido_privado_xyz' })],
    'invalido.json',
  );
  assert(invalid.response.status === 422, 'Unknown catalog code was not rejected.');
  assert(
    !JSON.stringify(invalid.payload).includes('contenido_privado_xyz'),
    'Catalog validation reflected file-controlled content.',
  );
  assert(
    JSON.stringify(await factCounts()) === JSON.stringify(beforeInvalid),
    'Rejected import left a partial batch or fact.',
  );

  const history = await http(
    baseUrl,
    adminJar,
    '/api/v1/admin/importaciones?page=1&limit=20',
  );
  assert(history.response.status === 200, 'Import history failed.');
  assert(history.payload.meta.total === 3, 'History did not expose every confirmed unique batch.');
  assert(
    history.payload.data.importaciones.every((item) => !('hash_contenido_sha256' in item)),
    'History leaked internal hashes.',
  );

  console.log(
    'PostgreSQL import integration passed: migration up/down, 415 media status, public detail, multipart auth/CSRF, atomic inserts, exact and concurrent idempotency, source isolation, privacy, rollback, and history.',
  );
} finally {
  if (httpServer) await new Promise((resolveClose) => httpServer.close(resolveClose));
  if (auth) await auth.sessionStore.close();
  if (pool) await pool.end();
  if (maintenance._connected) {
    await maintenance.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await maintenance.end();
  }
}
