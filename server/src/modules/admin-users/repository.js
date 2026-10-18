export class AdminUserRepositoryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AdminUserRepositoryError';
    this.code = code;
  }
}

const MAX_AUTH_VERSION = 9_223_372_036_854_775_807n;

function assertAuthVersionCanIncrement(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || BigInt(value) >= MAX_AUTH_VERSION) {
    throw new AdminUserRepositoryError('auth_version_overflow');
  }
}

async function rollback(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original transaction error.
  }
}

async function withTransaction(pool, operation) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

function publicUserColumns(alias = 'u') {
  return `
    ${alias}.id,
    ${alias}.usuario,
    ${alias}.nombre_mostrar AS nombre,
    ${alias}.correo,
    ${alias}.rol_codigo AS rol,
    ${alias}.activo,
    ${alias}.ultimo_acceso_en,
    ${alias}.creado_en,
    ${alias}.actualizado_en`;
}

async function revokeUserSessions(client, userId) {
  await client.query(
    `DELETE FROM sesiones_http
     WHERE sess ->> 'userId' = $1`,
    [String(userId)],
  );
}

export function createAdminUsersRepository(pool) {
  return {
    async list({ page, limit, search, role, active }) {
      const offset = (page - 1) * limit;
      const result = await pool.query(
        `WITH filtered AS MATERIALIZED (
           SELECT ${publicUserColumns()}
           FROM usuarios AS u
           WHERE (
             $1::text IS NULL
             OR strpos(lower(u.usuario), lower($1)) > 0
             OR strpos(lower(u.nombre_mostrar), lower($1)) > 0
             OR strpos(lower(COALESCE(u.correo, '')), lower($1)) > 0
           )
             AND ($2::text IS NULL OR u.rol_codigo = $2)
             AND ($3::boolean IS NULL OR u.activo = $3)
         ), counted AS (
           SELECT filtered.*, count(*) OVER()::int AS total
           FROM filtered
         ), paged AS (
           SELECT *
           FROM counted
           ORDER BY lower(usuario), id
           LIMIT $4 OFFSET $5
         ), fallback AS (
           SELECT count(*)::int AS total FROM filtered
         )
         SELECT
           COALESCE(paged.total, fallback.total) AS total,
           paged.id,
           paged.usuario,
           paged.nombre,
           paged.correo,
           paged.rol,
           paged.activo,
           paged.ultimo_acceso_en,
           paged.creado_en,
           paged.actualizado_en
         FROM fallback
         LEFT JOIN paged ON TRUE
         ORDER BY lower(paged.usuario), paged.id`,
        [search ?? null, role ?? null, active ?? null, limit, offset],
      );

      return {
        total: Number(result.rows[0]?.total ?? 0),
        users: result.rows
          .filter((row) => row.id !== null)
          .map(({ total: _total, ...user }) => user),
      };
    },

    async create({ username, name, email, role, passwordHash }) {
      const result = await pool.query(
        `INSERT INTO usuarios (
           rol_codigo, usuario, nombre_mostrar, correo, password_hash, activo
         )
         VALUES ($1, $2, $3, $4, $5, TRUE)
         RETURNING ${publicUserColumns('usuarios')}`,
        [role, username, name, email, passwordHash],
      );

      return result.rows[0];
    },

    async update({ targetId, actorId, patch }) {
      return withTransaction(pool, async (client) => {
        const activeAdmins = await client.query(
          `SELECT id
           FROM usuarios
           WHERE rol_codigo = 'admin' AND activo = TRUE
           ORDER BY id
           FOR UPDATE`,
        );
        const targetResult = await client.query(
          `SELECT ${publicUserColumns()}, u.auth_version::text AS auth_version
           FROM usuarios AS u
           WHERE u.id = $1
           FOR UPDATE`,
          [targetId],
        );
        const current = targetResult.rows[0];

        if (!current) throw new AdminUserRepositoryError('not_found');

        const next = {
          nombre: patch.nombre ?? current.nombre,
          rol: patch.rol ?? current.rol,
          activo: patch.activo ?? current.activo,
        };
        const removesActiveAdmin =
          current.rol === 'admin' && current.activo && (next.rol !== 'admin' || !next.activo);
        const invalidatesAuthentication =
          next.rol !== current.rol || next.activo !== current.activo;

        if (removesActiveAdmin && activeAdmins.rows.length <= 1) {
          throw new AdminUserRepositoryError('last_active_admin');
        }
        if (removesActiveAdmin && String(current.id) === String(actorId)) {
          throw new AdminUserRepositoryError('self_protection');
        }

        const changed =
          next.nombre !== current.nombre ||
          next.rol !== current.rol ||
          next.activo !== current.activo;

        if (!changed) return { user: current, changed: false };
        if (invalidatesAuthentication) assertAuthVersionCanIncrement(current.auth_version);

        const updated = await client.query(
          `UPDATE usuarios
           SET nombre_mostrar = $2,
               rol_codigo = $3,
               activo = $4,
               auth_version = CASE WHEN $5 THEN auth_version + 1 ELSE auth_version END,
               actualizado_en = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING ${publicUserColumns('usuarios')}`,
          [targetId, next.nombre, next.rol, next.activo, invalidatesAuthentication],
        );

        if (invalidatesAuthentication) {
          await revokeUserSessions(client, targetId);
        }

        return { user: updated.rows[0], changed: true };
      });
    },

    async resetPassword({ targetId, passwordHash }) {
      return withTransaction(pool, async (client) => {
        const target = await client.query(
          `SELECT id, auth_version::text AS auth_version
           FROM usuarios
           WHERE id = $1
           FOR UPDATE`,
          [targetId],
        );

        if (!target.rows[0]) throw new AdminUserRepositoryError('not_found');
        assertAuthVersionCanIncrement(target.rows[0].auth_version);

        const updated = await client.query(
          `UPDATE usuarios
           SET password_hash = $2,
               auth_version = auth_version + 1,
               actualizado_en = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING ${publicUserColumns('usuarios')}`,
          [targetId, passwordHash],
        );
        await revokeUserSessions(client, targetId);
        return updated.rows[0];
      });
    },
  };
}
