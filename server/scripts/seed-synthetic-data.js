import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../src/config/env.js';
import { closeDatabasePool, createDatabasePool } from '../src/db/pool.js';
import {
  attentionEndAt,
  generateSyntheticDataset,
  reconcileSyntheticRows,
  syntheticDatasetSummary,
} from '../src/modules/analytics/synthetic-data.js';

const BATCH_SIZE = 200;

function chunks(items, size = BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function placeholders(rows, columns) {
  return rows
    .map((_, rowIndex) => {
      const values = Array.from(
        { length: columns },
        (_value, columnIndex) => `$${rowIndex * columns + columnIndex + 1}`,
      );
      return `(${values.join(', ')})`;
    })
    .join(', ');
}

async function originCounts(client, source, batchId) {
  const result = await client.query(
    `SELECT
       (SELECT count(*)::int FROM solicitudes_atencion WHERE sistema_origen = $1) AS requests,
       (SELECT count(*)::int FROM citas WHERE sistema_origen = $1) AS appointments,
       (SELECT count(*)::int FROM atenciones_realizadas WHERE sistema_origen = $1) AS attentions,
       (SELECT count(*)::int FROM solicitudes_atencion WHERE sistema_origen = $1 AND lote_importacion_id <> $2) AS requests_other_batch,
       (SELECT count(*)::int FROM citas WHERE sistema_origen = $1 AND lote_importacion_id <> $2) AS appointments_other_batch,
       (SELECT count(*)::int FROM atenciones_realizadas WHERE sistema_origen = $1 AND lote_importacion_id <> $2) AS attentions_other_batch`,
    [source, batchId ?? 0],
  );
  return result.rows[0];
}

async function reconciliationRows(client, source, batchId) {
  const result = await client.query(
    `SELECT
       s.clave_origen AS "requestKey",
       s.tipo_atencion_codigo AS "requestCareType",
       s.estado_solicitud_codigo AS "requestStatus",
       s.unidad_organizacional_id AS "requestUnitId",
       extract(epoch FROM s.solicitada_en)::bigint AS "requestEpoch",
       extract(epoch FROM s.cerrada_en)::bigint AS "closedEpoch",
       c.clave_origen AS "appointmentKey",
       c.tipo_atencion_codigo AS "appointmentCareType",
       c.estado_cita_codigo AS "appointmentStatus",
       c.unidad_organizacional_id AS "appointmentUnitId",
       c.solicitud_atencion_id = s.id AS "appointmentLinked",
       extract(epoch FROM c.inicio_agendado_en)::bigint AS "appointmentEpoch",
       a.id IS NOT NULL AS "attentionPresent",
       a.clave_origen AS "attentionKey",
       COALESCE(a.cita_id = c.id, FALSE) AS "attentionLinked",
       extract(epoch FROM a.llegada_en)::bigint AS "arrivalEpoch",
       extract(epoch FROM a.inicio_atencion_en)::bigint AS "attentionStartEpoch",
       extract(epoch FROM a.fin_atencion_en)::bigint AS "attentionEndEpoch",
       a.duracion_espera_reportada_minutos AS wait
     FROM solicitudes_atencion AS s
     JOIN citas AS c
       ON c.solicitud_atencion_id = s.id
      AND c.sistema_origen = $1
      AND c.lote_importacion_id = $2
     LEFT JOIN atenciones_realizadas AS a
       ON a.cita_id = c.id
      AND a.sistema_origen = $1
      AND a.lote_importacion_id = $2
     WHERE s.sistema_origen = $1
       AND s.lote_importacion_id = $2
     ORDER BY s.clave_origen`,
    [source, batchId],
  );
  return result.rows;
}

async function reconcileExisting(client, dataset, batch) {
  const summary = syntheticDatasetSummary(dataset);
  const counts = await originCounts(client, dataset.source, batch.id);
  const metadataMatches =
    batch.hash_contenido_sha256 === dataset.contentHash &&
    Number(batch.cantidad_registros) === summary.requests &&
    Number(batch.cantidad_insertados) === summary.requests &&
    Number(batch.cantidad_actualizados) === 0 &&
    Number(batch.cantidad_omitidos) === 0;
  const countsMatch =
    counts.requests === summary.requests &&
    counts.appointments === summary.appointments &&
    counts.attentions === summary.attended &&
    counts.requests_other_batch === 0 &&
    counts.appointments_other_batch === 0 &&
    counts.attentions_other_batch === 0;
  const rows = await reconciliationRows(client, dataset.source, batch.id);

  if (!metadataMatches || !countsMatch || !reconcileSyntheticRows(dataset, rows)) {
    throw new Error('La semilla sintética existente está incompleta o es inconsistente.');
  }
}

async function insertRequests(client, dataset, batchId) {
  const requestIds = new Map();

  for (const batch of chunks(dataset.records)) {
    const values = batch.flatMap((record) => [
      batchId,
      dataset.source,
      record.key,
      record.careType,
      record.requestAt,
      record.closedAt,
    ]);
    const result = await client.query(
      `INSERT INTO solicitudes_atencion (
         lote_importacion_id, sistema_origen, clave_origen, tipo_atencion_codigo,
         estado_solicitud_codigo, solicitada_en, cerrada_en
       )
       VALUES ${placeholders(batch, 6).replaceAll(
         /\((\$\d+), (\$\d+), (\$\d+), (\$\d+), (\$\d+), (\$\d+)\)/g,
         "($1, $2, $3, $4, 'cerrada', $5, $6)",
       )}
       RETURNING id, clave_origen`,
      values,
    );
    result.rows.forEach((row) => requestIds.set(row.clave_origen, row.id));
  }

  return requestIds;
}

async function insertAppointments(client, dataset, batchId, requestIds) {
  const appointmentIds = new Map();

  for (const batch of chunks(dataset.records)) {
    const values = batch.flatMap((record) => [
      batchId,
      dataset.source,
      record.key,
      requestIds.get(record.key),
      record.careType,
      record.appointmentStatus,
      record.appointmentAt,
    ]);
    const result = await client.query(
      `INSERT INTO citas (
         lote_importacion_id, sistema_origen, clave_origen, solicitud_atencion_id,
         tipo_atencion_codigo, estado_cita_codigo, inicio_agendado_en
       )
       VALUES ${placeholders(batch, 7)}
       RETURNING id, clave_origen`,
      values,
    );
    result.rows.forEach((row) => appointmentIds.set(row.clave_origen, row.id));
  }

  return appointmentIds;
}

async function insertAttentions(client, dataset, batchId, appointmentIds) {
  const attended = dataset.records.filter((record) => record.appointmentStatus === 'atendida');

  for (const batch of chunks(attended)) {
    const values = batch.flatMap((record) => [
      batchId,
      dataset.source,
      record.key,
      appointmentIds.get(record.key),
      record.appointmentAt,
      attentionEndAt(record),
      record.wait,
    ]);
    await client.query(
      `INSERT INTO atenciones_realizadas (
         lote_importacion_id, sistema_origen, clave_origen, cita_id,
         inicio_atencion_en, fin_atencion_en, duracion_espera_reportada_minutos
       )
       VALUES ${placeholders(batch, 7)}`,
      values,
    );
  }
}

export async function runSyntheticSeed({ pool, environment }) {
  if (!['development', 'test'].includes(environment.NODE_ENV)) {
    throw new Error('La semilla sintética solo está permitida en development o test.');
  }

  const dataset = generateSyntheticDataset();
  const summary = syntheticDatasetSummary(dataset);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [dataset.source]);
    const existing = await client.query(
      `SELECT id, clave_origen, hash_contenido_sha256, cantidad_registros,
              cantidad_insertados, cantidad_actualizados, cantidad_omitidos
       FROM lotes_importacion
       WHERE sistema_origen = $1
       FOR UPDATE`,
      [dataset.source],
    );
    const canonicalBatch = existing.rows.find(
      (batch) => batch.clave_origen === dataset.batchKey,
    );

    if (canonicalBatch) {
      if (existing.rows.length !== 1) {
        throw new Error('Existen lotes sintéticos adicionales al lote canónico.');
      }
      await reconcileExisting(client, dataset, canonicalBatch);
      await client.query('COMMIT');
      return { status: 'already_present', ...summary };
    }

    if (existing.rows.length > 0) {
      throw new Error('Existe un lote sintético con una clave no canónica.');
    }

    const orphanCounts = await originCounts(client, dataset.source, null);
    if (orphanCounts.requests || orphanCounts.appointments || orphanCounts.attentions) {
      throw new Error('Existen hechos sintéticos sin el lote canónico.');
    }

    const insertedBatch = await client.query(
      `INSERT INTO lotes_importacion (
         sistema_origen, clave_origen, version_contrato, formato, nombre_archivo,
         hash_contenido_sha256, cantidad_registros, cantidad_insertados, cantidad_omitidos
       ) VALUES ($1, $2, '1.0', 'json', $3, $4, $5, $5, 0)
       RETURNING id`,
      [
        dataset.source,
        dataset.batchKey,
        'semilla-sintetica-dashboard-v1.json',
        dataset.contentHash,
        summary.requests,
      ],
    );
    const batchId = insertedBatch.rows[0].id;
    const requestIds = await insertRequests(client, dataset, batchId);
    const appointmentIds = await insertAppointments(client, dataset, batchId, requestIds);
    await insertAttentions(client, dataset, batchId, appointmentIds);
    await client.query('COMMIT');
    return { status: 'created', ...summary };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const environment = loadEnvironment();
  const pool = createDatabasePool(environment.DATABASE_URL);

  try {
    const result = await runSyntheticSeed({ pool, environment });
    console.log(
      `Semilla sintética: ${result.status}; solicitudes=${result.requests}; citas=${result.appointments}; atenciones=${result.attended}; inasistencias=${result.absences}.`,
    );
  } catch {
    console.error('No fue posible aplicar la semilla sintética.');
    process.exitCode = 1;
  } finally {
    await closeDatabasePool(pool);
  }
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) await main();
