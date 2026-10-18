import pg from 'pg';

const { Pool } = pg;

export function createDatabasePool(databaseUrl) {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
}

export async function closeDatabasePool(pool) {
  await pool.end();
}
