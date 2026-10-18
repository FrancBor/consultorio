const TIME_ZONE = 'America/Santiago';

export function createAnalyticsRepository(pool) {
  return {
    async getAbsence({ desde, hasta }) {
      const result = await pool.query(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', $1::date)::date,
             date_trunc('month', $2::date)::date,
             interval '1 month'
           )::date AS month
         ), monthly AS (
           SELECT
             date_trunc('month', inicio_agendado_en AT TIME ZONE '${TIME_ZONE}')::date AS month,
             (count(*) FILTER (WHERE estado_cita_codigo IN ('atendida', 'inasistencia')))::int AS resolved,
             (count(*) FILTER (WHERE estado_cita_codigo = 'inasistencia'))::int AS absences
           FROM citas
           WHERE inicio_agendado_en >= ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}')
             AND inicio_agendado_en < (($2::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}')
           GROUP BY 1
         ), totals AS (
           SELECT
             COALESCE(sum(resolved), 0)::int AS resolved,
             COALESCE(sum(absences), 0)::int AS absences
           FROM monthly
         )
         SELECT
           totals.resolved,
           totals.absences,
           totals.absences::float8 / NULLIF(totals.resolved, 0) AS rate,
           json_agg(
             json_build_object(
               'periodo', to_char(months.month, 'YYYY-MM'),
               'valor', monthly.absences::float8 / NULLIF(monthly.resolved, 0)
             ) ORDER BY months.month
           ) AS series
         FROM totals
         CROSS JOIN months
         LEFT JOIN monthly ON monthly.month = months.month
         GROUP BY totals.resolved, totals.absences`,
        [desde, hasta],
      );
      return result.rows[0];
    },

    async getAttendances({ desde, hasta }) {
      const result = await pool.query(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', $1::date)::date,
             date_trunc('month', $2::date)::date,
             interval '1 month'
           )::date AS month
         ), monthly AS (
           SELECT
             date_trunc('month', c.inicio_agendado_en AT TIME ZONE '${TIME_ZONE}')::date AS month,
             count(a.id)::int AS total
           FROM atenciones_realizadas AS a
           JOIN citas AS c ON c.id = a.cita_id
           WHERE c.estado_cita_codigo = 'atendida'
             AND c.inicio_agendado_en >= ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}')
             AND c.inicio_agendado_en < (($2::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}')
           GROUP BY 1
         )
         SELECT
           COALESCE(sum(monthly.total), 0)::int AS total,
           json_agg(
             json_build_object(
               'periodo', to_char(months.month, 'YYYY-MM'),
               'valor', COALESCE(monthly.total, 0)
             ) ORDER BY months.month
           ) AS series
         FROM months
         LEFT JOIN monthly ON monthly.month = months.month`,
        [desde, hasta],
      );
      return result.rows[0];
    },

    async getWaitTime({ desde, hasta }) {
      const result = await pool.query(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', $1::date)::date,
             date_trunc('month', $2::date)::date,
             interval '1 month'
           )::date AS month
         ), waits AS (
           SELECT
             date_trunc('month', c.inicio_agendado_en AT TIME ZONE '${TIME_ZONE}')::date AS month,
             CASE
               WHEN a.llegada_en IS NOT NULL
                 THEN extract(epoch FROM (a.inicio_atencion_en - a.llegada_en)) / 60.0
               ELSE a.duracion_espera_reportada_minutos::numeric
             END AS wait_minutes
           FROM atenciones_realizadas AS a
           JOIN citas AS c ON c.id = a.cita_id
           WHERE c.estado_cita_codigo = 'atendida'
             AND c.inicio_agendado_en >= ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}')
             AND c.inicio_agendado_en < (($2::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}')
         ), monthly AS (
           SELECT month, round(avg(wait_minutes), 1)::float8 AS average
           FROM waits
           WHERE wait_minutes IS NOT NULL
           GROUP BY month
         )
         SELECT
           (SELECT round(avg(wait_minutes), 1)::float8 FROM waits WHERE wait_minutes IS NOT NULL) AS average,
           json_agg(
             json_build_object(
               'periodo', to_char(months.month, 'YYYY-MM'),
               'valor', monthly.average
             ) ORDER BY months.month
           ) AS series
         FROM months
         LEFT JOIN monthly ON monthly.month = months.month`,
        [desde, hasta],
      );
      return result.rows[0];
    },

    async getScheduleHours({ desde, hasta }) {
      const result = await pool.query(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', $1::date)::date,
             date_trunc('month', $2::date)::date,
             interval '1 month'
           )::date AS month
         ), monthly AS (
           SELECT
             date_trunc('month', inicio_agendado_en AT TIME ZONE '${TIME_ZONE}')::date AS month,
             (count(*) FILTER (WHERE estado_cita_codigo IN ('atendida', 'inasistencia')))::int AS scheduled,
             (count(*) FILTER (WHERE estado_cita_codigo = 'atendida'))::int AS used
           FROM citas
           WHERE inicio_agendado_en >= ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}')
             AND inicio_agendado_en < (($2::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}')
           GROUP BY 1
         ), totals AS (
           SELECT
             COALESCE(sum(scheduled), 0)::int AS scheduled,
             COALESCE(sum(used), 0)::int AS used
           FROM monthly
         )
         SELECT
           totals.scheduled,
           totals.used,
           totals.used::float8 / NULLIF(totals.scheduled, 0) AS usage,
           json_agg(
             json_build_object(
               'periodo', to_char(months.month, 'YYYY-MM'),
               'agendadas', COALESCE(monthly.scheduled, 0),
               'utilizadas', COALESCE(monthly.used, 0)
             ) ORDER BY months.month
           ) AS series
         FROM totals
         CROSS JOIN months
         LEFT JOIN monthly ON monthly.month = months.month
         GROUP BY totals.scheduled, totals.used`,
        [desde, hasta],
      );
      return result.rows[0];
    },

    async getDemand({ desde, hasta }) {
      const result = await pool.query(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', $1::date)::date,
             date_trunc('month', $2::date)::date,
             interval '1 month'
           )::date AS month
         ), monthly AS (
           SELECT
             date_trunc('month', solicitada_en AT TIME ZONE '${TIME_ZONE}')::date AS month,
             count(*)::int AS total
           FROM solicitudes_atencion
           WHERE solicitada_en >= ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}')
             AND solicitada_en < (($2::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}')
           GROUP BY 1
         )
         SELECT
           COALESCE(sum(monthly.total), 0)::int AS total,
           json_agg(
             json_build_object(
               'periodo', to_char(months.month, 'YYYY-MM'),
               'valor', COALESCE(monthly.total, 0)
             ) ORDER BY months.month
           ) AS series
         FROM months
         LEFT JOIN monthly ON monthly.month = months.month`,
        [desde, hasta],
      );
      return result.rows[0];
    },

    async getDetails({ desde, hasta, page, limit }) {
      const offset = (page - 1) * limit;
      const result = await pool.query(
        `WITH filtered AS MATERIALIZED (
           SELECT
             c.id,
             c.inicio_agendado_en AS sort_at,
             to_char(c.inicio_agendado_en AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM-DD') AS fecha,
             to_char(c.inicio_agendado_en AT TIME ZONE '${TIME_ZONE}', 'HH24:MI') AS hora_agendada,
             t.etiqueta AS tipo_atencion,
             c.estado_cita_codigo AS estado,
             CASE
               WHEN c.estado_cita_codigo <> 'atendida' THEN NULL
               WHEN a.llegada_en IS NOT NULL
                 THEN round(extract(epoch FROM (a.inicio_atencion_en - a.llegada_en)) / 60.0)::int
               ELSE a.duracion_espera_reportada_minutos
             END AS tiempo_espera_minutos
           FROM citas AS c
           JOIN tipos_atencion AS t ON t.codigo = c.tipo_atencion_codigo
           LEFT JOIN atenciones_realizadas AS a ON a.cita_id = c.id
           WHERE c.inicio_agendado_en >= ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}')
             AND c.inicio_agendado_en < (($2::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}')
         ), counted AS (
           SELECT filtered.*, count(*) OVER()::int AS total
           FROM filtered
         ), paged AS (
           SELECT *
           FROM counted
           ORDER BY sort_at, id
           LIMIT $3 OFFSET $4
         ), fallback AS (
           SELECT count(*)::int AS total FROM filtered
         )
         SELECT
           COALESCE(paged.total, fallback.total) AS total,
           paged.id,
           paged.fecha,
           paged.hora_agendada,
           paged.tipo_atencion,
           paged.estado,
           paged.tiempo_espera_minutos,
           paged.sort_at
         FROM fallback
         LEFT JOIN paged ON TRUE
         ORDER BY paged.sort_at, paged.id`,
        [desde, hasta, limit, offset],
      );
      const total = Number(result.rows[0]?.total ?? 0);
      const items = result.rows
        .filter((row) => row.id !== null)
        .map(({ total: _total, sort_at: _sortAt, ...item }) => item);

      return { total, items };
    },
  };
}
