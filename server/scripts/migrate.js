import { config } from 'dotenv';
import { runner } from 'node-pg-migrate';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const serverDirectory = resolve(scriptDirectory, '..');

config({ path: resolve(serverDirectory, '.env'), quiet: true });

const direction = process.argv[2];

if (!['up', 'down'].includes(direction)) {
  console.error('Uso: node scripts/migrate.js <up|down>');
  process.exitCode = 1;
} else if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL es obligatoria. Copie .env.example como .env y configúrela localmente.',
  );
  process.exitCode = 1;
} else {
  try {
    await runner({
      databaseUrl: process.env.DATABASE_URL,
      dir: resolve(serverDirectory, 'db', 'migrations'),
      direction,
      count: direction === 'down' ? 1 : Number.POSITIVE_INFINITY,
      migrationsTable: 'schema_migrations',
      migrationLoaderStrategies: [{ extensions: ['.sql'], loader: 'sql' }],
    });
  } catch {
    console.error(
      'La migración falló. Revise la salida anterior y la configuración local de PostgreSQL.',
    );
    process.exitCode = 1;
  }
}
