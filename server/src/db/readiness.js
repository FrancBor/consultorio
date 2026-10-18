export function createReadinessCheck(pool) {
  return async function checkReadiness() {
    await pool.query('SELECT 1');
  };
}
