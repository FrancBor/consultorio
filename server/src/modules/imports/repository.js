import { IMPORT_SOURCE } from './parser.js';

export class ImportRepositoryError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'ImportRepositoryError';
    this.code = code;
    this.details = details;
  }
}

async function rollback(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original transaction error.
  }
}

function batchColumns(alias = 'l') {
  return `
    ${alias}.id,
    ${alias}.formato,
    ${alias}.nombre_archivo,
    ${alias}.cantidad_registros,
    ${alias}.cantidad_insertados,
    ${alias}.cantidad_actualizados,
    ${alias}.cantidad_omitidos,
    ${alias}.importado_en`;
}

async function stageRecords(client, records) {
  await client.query(
    `CREATE TEMP TABLE import_rows (
       record_number integer PRIMARY KEY,
       clave_origen varchar(200) NOT NULL,
       tipo_atencion_codigo varchar(50) NOT NULL,
       estado_solicitud_codigo varchar(50) NOT NULL,
       unidad_codigo varchar(50),
       solicitada_en timestamptz NOT NULL,
       cerrada_en timestamptz,
       estado_cita_codigo varchar(50) NOT NULL,
       inicio_agendado_en timestamptz NOT NULL,
       llegada_en timestamptz,
       inicio_atencion_en timestamptz,
       fin_atencion_en timestamptz,
       duracion_espera_reportada_minutos integer
     ) ON COMMIT DROP`,
  );
  await client.query(
    `INSERT INTO import_rows
     SELECT *
     FROM jsonb_to_recordset($1::jsonb) AS row(
       record_number integer,
       clave_origen varchar(200),
       tipo_atencion_codigo varchar(50),
       estado_solicitud_codigo varchar(50),
       unidad_codigo varchar(50),
       solicitada_en timestamptz,
       cerrada_en timestamptz,
       estado_cita_codigo varchar(50),
       inicio_agendado_en timestamptz,
       llegada_en timestamptz,
       inicio_atencion_en timestamptz,
       fin_atencion_en timestamptz,
       duracion_espera_reportada_minutos integer
     )`,
    [JSON.stringify(records)],
  );
}

async function validateCatalogs(client) {
  const result = await client.query(
    `SELECT record_number, field
     FROM (
       SELECT r.record_number, 'tipo_atencion_codigo'::text AS field, r.tipo_atencion_codigo AS code
       FROM import_rows AS r
       LEFT JOIN tipos_atencion AS c ON c.codigo = r.tipo_atencion_codigo AND c.activo = TRUE
       WHERE c.codigo IS NULL
       UNION ALL
       SELECT r.record_number, 'estado_solicitud_codigo', r.estado_solicitud_codigo
       FROM import_rows AS r
       LEFT JOIN estados_solicitud AS c ON c.codigo = r.estado_solicitud_codigo AND c.activo = TRUE
       WHERE c.codigo IS NULL
       UNION ALL
       SELECT r.record_number, 'estado_cita_codigo', r.estado_cita_codigo
       FROM import_rows AS r
       LEFT JOIN estados_cita AS c ON c.codigo = r.estado_cita_codigo AND c.activo = TRUE
       WHERE c.codigo IS NULL
       UNION ALL
       SELECT r.record_number, 'unidad_codigo', r.unidad_codigo
       FROM import_rows AS r
       LEFT JOIN unidades_organizacionales AS c ON c.codigo = r.unidad_codigo AND c.activo = TRUE
       WHERE r.unidad_codigo IS NOT NULL AND c.id IS NULL
     ) AS missing
     ORDER BY record_number, field
     LIMIT 101`,
  );
  if (result.rows.length === 0) return;
  throw new ImportRepositoryError('validation_error', {
    errors: result.rows.slice(0, 100).map((row) => ({
      codigo: 'catalogo_no_encontrado',
      registro: row.record_number,
      campo: row.field,
      mensaje: 'El código indicado no existe o no está activo.',
    })),
    truncated: result.rows.length > 100,
  });
}

async function validateExistingIntegrity(client) {
  const result = await client.query(
    `SELECT r.record_number
     FROM import_rows AS r
     LEFT JOIN solicitudes_atencion AS s
       ON s.sistema_origen = $1 AND s.clave_origen = r.clave_origen
     LEFT JOIN citas AS c
       ON c.sistema_origen = $1 AND c.clave_origen = r.clave_origen
     LEFT JOIN atenciones_realizadas AS a
       ON a.sistema_origen = $1 AND a.clave_origen = r.clave_origen
     LEFT JOIN atenciones_realizadas AS linked_a ON linked_a.cita_id = c.id
     WHERE (s.id IS NULL) <> (c.id IS NULL)
        OR (c.id IS NOT NULL AND c.solicitud_atencion_id IS DISTINCT FROM s.id)
        OR (a.id IS NOT NULL AND a.cita_id IS DISTINCT FROM c.id)
         OR (
           linked_a.id IS NOT NULL
           AND (
             linked_a.sistema_origen IS DISTINCT FROM $1
             OR linked_a.clave_origen IS DISTINCT FROM r.clave_origen
             OR linked_a.cita_id IS DISTINCT FROM c.id
           )
         )
     ORDER BY r.record_number
     LIMIT 101`,
    [IMPORT_SOURCE],
  );
  if (result.rows.length === 0) return;
  throw new ImportRepositoryError('data_conflict', {
    errors: result.rows.slice(0, 100).map((row) => ({
      codigo: 'conflicto_datos_existentes',
      registro: row.record_number,
      campo: 'clave_origen',
      mensaje: 'La clave existente no conserva el vínculo solicitud, cita y atención esperado.',
    })),
    truncated: result.rows.length > 100,
  });
}

async function classifyRows(client) {
  await client.query(
    `CREATE TEMP TABLE import_classified ON COMMIT DROP AS
     SELECT r.*,
       CASE
         WHEN s.id IS NULL THEN 'inserted'
         WHEN (
           s.tipo_atencion_codigo = r.tipo_atencion_codigo
           AND s.estado_solicitud_codigo = r.estado_solicitud_codigo
           AND s.unidad_organizacional_id IS NOT DISTINCT FROM u.id
           AND s.solicitada_en = r.solicitada_en
           AND s.cerrada_en IS NOT DISTINCT FROM r.cerrada_en
           AND c.tipo_atencion_codigo = r.tipo_atencion_codigo
           AND c.estado_cita_codigo = r.estado_cita_codigo
           AND c.unidad_organizacional_id IS NOT DISTINCT FROM u.id
           AND c.inicio_agendado_en = r.inicio_agendado_en
           AND (
             (r.estado_cita_codigo <> 'atendida' AND a.id IS NULL)
             OR (
               r.estado_cita_codigo = 'atendida'
               AND a.id IS NOT NULL
               AND a.llegada_en IS NOT DISTINCT FROM r.llegada_en
               AND a.inicio_atencion_en = r.inicio_atencion_en
               AND a.fin_atencion_en IS NOT DISTINCT FROM r.fin_atencion_en
               AND a.duracion_espera_reportada_minutos
                   IS NOT DISTINCT FROM r.duracion_espera_reportada_minutos
             )
           )
         ) THEN 'omitted'
         ELSE 'updated'
       END AS action
     FROM import_rows AS r
     LEFT JOIN unidades_organizacionales AS u ON u.codigo = r.unidad_codigo
     LEFT JOIN solicitudes_atencion AS s
       ON s.sistema_origen = $1 AND s.clave_origen = r.clave_origen
     LEFT JOIN citas AS c
       ON c.sistema_origen = $1 AND c.clave_origen = r.clave_origen
     LEFT JOIN atenciones_realizadas AS a
       ON a.sistema_origen = $1 AND a.clave_origen = r.clave_origen`,
    [IMPORT_SOURCE],
  );
  const result = await client.query(
    `SELECT
       count(*) FILTER (WHERE action = 'inserted')::int AS inserted,
       count(*) FILTER (WHERE action = 'updated')::int AS updated,
       count(*) FILTER (WHERE action = 'omitted')::int AS omitted
     FROM import_classified`,
  );
  return result.rows[0];
}

async function writeRows(client, batchId) {
  await client.query(
    `INSERT INTO solicitudes_atencion (
       lote_importacion_id, sistema_origen, clave_origen, tipo_atencion_codigo,
       estado_solicitud_codigo, unidad_organizacional_id, solicitada_en, cerrada_en
     )
     SELECT $1, $2, r.clave_origen, r.tipo_atencion_codigo,
            r.estado_solicitud_codigo, u.id, r.solicitada_en, r.cerrada_en
     FROM import_classified AS r
     LEFT JOIN unidades_organizacionales AS u ON u.codigo = r.unidad_codigo
     WHERE r.action <> 'omitted'
     ON CONFLICT (sistema_origen, clave_origen) DO UPDATE
     SET lote_importacion_id = EXCLUDED.lote_importacion_id,
         tipo_atencion_codigo = EXCLUDED.tipo_atencion_codigo,
         estado_solicitud_codigo = EXCLUDED.estado_solicitud_codigo,
         unidad_organizacional_id = EXCLUDED.unidad_organizacional_id,
         solicitada_en = EXCLUDED.solicitada_en,
         cerrada_en = EXCLUDED.cerrada_en,
         actualizado_en = CURRENT_TIMESTAMP`,
    [batchId, IMPORT_SOURCE],
  );

  await client.query(
    `INSERT INTO citas (
       lote_importacion_id, sistema_origen, clave_origen, solicitud_atencion_id,
       tipo_atencion_codigo, estado_cita_codigo, unidad_organizacional_id, inicio_agendado_en
     )
     SELECT $1, $2, r.clave_origen, s.id, r.tipo_atencion_codigo,
            r.estado_cita_codigo, u.id, r.inicio_agendado_en
     FROM import_classified AS r
     JOIN solicitudes_atencion AS s
       ON s.sistema_origen = $2 AND s.clave_origen = r.clave_origen
     LEFT JOIN unidades_organizacionales AS u ON u.codigo = r.unidad_codigo
     WHERE r.action <> 'omitted'
     ON CONFLICT (sistema_origen, clave_origen) DO UPDATE
     SET lote_importacion_id = EXCLUDED.lote_importacion_id,
         solicitud_atencion_id = EXCLUDED.solicitud_atencion_id,
         tipo_atencion_codigo = EXCLUDED.tipo_atencion_codigo,
         estado_cita_codigo = EXCLUDED.estado_cita_codigo,
         unidad_organizacional_id = EXCLUDED.unidad_organizacional_id,
         inicio_agendado_en = EXCLUDED.inicio_agendado_en,
         actualizado_en = CURRENT_TIMESTAMP`,
    [batchId, IMPORT_SOURCE],
  );

  await client.query(
    `DELETE FROM atenciones_realizadas AS a
     USING citas AS c, import_classified AS r
     WHERE a.cita_id = c.id
       AND a.sistema_origen = $1
       AND c.sistema_origen = $1
       AND c.clave_origen = r.clave_origen
       AND r.action <> 'omitted'
       AND r.estado_cita_codigo <> 'atendida'`,
    [IMPORT_SOURCE],
  );

  await client.query(
    `INSERT INTO atenciones_realizadas (
       lote_importacion_id, sistema_origen, clave_origen, cita_id, llegada_en,
       inicio_atencion_en, fin_atencion_en, duracion_espera_reportada_minutos
     )
     SELECT $1, $2, r.clave_origen, c.id, r.llegada_en,
            r.inicio_atencion_en, r.fin_atencion_en, r.duracion_espera_reportada_minutos
     FROM import_classified AS r
     JOIN citas AS c ON c.sistema_origen = $2 AND c.clave_origen = r.clave_origen
     WHERE r.action <> 'omitted' AND r.estado_cita_codigo = 'atendida'
     ON CONFLICT (sistema_origen, clave_origen) DO UPDATE
     SET lote_importacion_id = EXCLUDED.lote_importacion_id,
         cita_id = EXCLUDED.cita_id,
         llegada_en = EXCLUDED.llegada_en,
         inicio_atencion_en = EXCLUDED.inicio_atencion_en,
         fin_atencion_en = EXCLUDED.fin_atencion_en,
         duracion_espera_reportada_minutos = EXCLUDED.duracion_espera_reportada_minutos`,
    [batchId, IMPORT_SOURCE],
  );
}

export function createImportsRepository(pool) {
  return {
    async list({ page, limit }) {
      const offset = (page - 1) * limit;
      const result = await pool.query(
        `WITH filtered AS MATERIALIZED (
           SELECT ${batchColumns()}, u.usuario, u.nombre_mostrar AS nombre_usuario
           FROM lotes_importacion AS l
           LEFT JOIN usuarios AS u ON u.id = l.importado_por_usuario_id
           WHERE l.sistema_origen = $1
         ), counted AS (
           SELECT filtered.*, count(*) OVER()::int AS total FROM filtered
         ), paged AS (
           SELECT * FROM counted
           ORDER BY importado_en DESC, id DESC
           LIMIT $2 OFFSET $3
         ), fallback AS (
           SELECT count(*)::int AS total FROM filtered
         )
         SELECT
           COALESCE(paged.total, fallback.total) AS total,
           paged.id,
           paged.formato,
           paged.nombre_archivo,
           paged.cantidad_registros,
           paged.cantidad_insertados,
           paged.cantidad_actualizados,
           paged.cantidad_omitidos,
           paged.importado_en,
           paged.usuario,
           paged.nombre_usuario
         FROM fallback
         LEFT JOIN paged ON TRUE
         ORDER BY paged.importado_en DESC, paged.id DESC`,
        [IMPORT_SOURCE, limit, offset],
      );
      return {
        total: Number(result.rows[0]?.total ?? 0),
        batches: result.rows
          .filter((row) => row.id !== null)
          .map(({ total: _total, ...batch }) => batch),
      };
    },

    async findById(id) {
      const result = await pool.query(
        `SELECT ${batchColumns()}, u.usuario, u.nombre_mostrar AS nombre_usuario
         FROM lotes_importacion AS l
         LEFT JOIN usuarios AS u ON u.id = l.importado_por_usuario_id
         WHERE l.id = $1 AND l.sistema_origen = $2`,
        [id, IMPORT_SOURCE],
      );
      return result.rows[0] ?? null;
    },

    async import({ records, hash, format, filename, actorId }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [IMPORT_SOURCE]);
        const existing = await client.query(
          `SELECT ${batchColumns()}
           FROM lotes_importacion AS l
           WHERE l.sistema_origen = $1 AND l.hash_contenido_sha256 = $2
           FOR UPDATE`,
          [IMPORT_SOURCE, hash],
        );
        if (existing.rows[0]) {
          await client.query('COMMIT');
          return { batch: existing.rows[0], repeated: true };
        }

        await stageRecords(client, records);
        await validateCatalogs(client);
        await validateExistingIntegrity(client);
        const counts = await classifyRows(client);
        const insertedBatch = await client.query(
          `INSERT INTO lotes_importacion (
             sistema_origen, clave_origen, version_contrato, formato, nombre_archivo,
             hash_contenido_sha256, cantidad_registros, cantidad_insertados,
             cantidad_actualizados, cantidad_omitidos, importado_por_usuario_id
           )
           VALUES ($1, $2, '1.0', $3, $4, $2, $5, $6, $7, $8, $9)
           RETURNING ${batchColumns('lotes_importacion')}`,
          [
            IMPORT_SOURCE,
            hash,
            format,
            filename,
            records.length,
            counts.inserted,
            counts.updated,
            counts.omitted,
            actorId,
          ],
        );
        await writeRows(client, insertedBatch.rows[0].id);
        await client.query('COMMIT');
        return { batch: insertedBatch.rows[0], repeated: false };
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
