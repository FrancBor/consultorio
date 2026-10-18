export function createAuthRepository(pool) {
  return {
    async findByUsername(username) {
      const result = await pool.query(
        `SELECT
           u.id,
           u.usuario,
           u.nombre_mostrar,
           u.rol_codigo,
           u.password_hash,
           u.auth_version::text AS auth_version,
           u.activo,
           r.activo AS rol_activo
         FROM usuarios AS u
         JOIN roles_usuario AS r ON r.codigo = u.rol_codigo
         WHERE lower(u.usuario) = lower($1)
         LIMIT 1`,
        [username],
      );

      return result.rows[0] ?? null;
    },

    async findActiveById(userId) {
      const result = await pool.query(
        `SELECT
           u.id,
           u.usuario,
           u.nombre_mostrar,
           u.rol_codigo,
           u.auth_version::text AS auth_version
         FROM usuarios AS u
         JOIN roles_usuario AS r ON r.codigo = u.rol_codigo
         WHERE u.id = $1
           AND u.activo = TRUE
           AND r.activo = TRUE
         LIMIT 1`,
        [userId],
      );

      return result.rows[0] ?? null;
    },

    async finalizeSuccessfulLogin({ userId, authVersion, passwordHash }) {
      const result = await pool.query(
        `UPDATE usuarios AS u
         SET ultimo_acceso_en = CURRENT_TIMESTAMP
         WHERE u.id = $1
           AND u.activo = TRUE
           AND u.auth_version = $2::bigint
           AND u.password_hash = $3
           AND EXISTS (
             SELECT 1
             FROM roles_usuario AS r
             WHERE r.codigo = u.rol_codigo AND r.activo = TRUE
           )
         RETURNING u.auth_version::text AS auth_version`,
        [userId, authVersion, passwordHash],
      );

      return result.rows[0]?.auth_version;
    },

    async createAdmin({ username, name, passwordHash }) {
      const result = await pool.query(
        `INSERT INTO usuarios (
           rol_codigo,
           usuario,
           nombre_mostrar,
           password_hash,
           activo
         )
         VALUES ('admin', $1, $2, $3, TRUE)
         RETURNING id, usuario, nombre_mostrar, rol_codigo`,
        [username, name, passwordHash],
      );

      return result.rows[0];
    },
  };
}
