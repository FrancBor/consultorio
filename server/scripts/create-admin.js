import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdminCreationError, createAdminAccount } from '../src/modules/auth/admin.js';
import { loadEnvironment } from '../src/config/env.js';
import { closeDatabasePool, createDatabasePool } from '../src/db/pool.js';
import { createAuthRepository } from '../src/modules/auth/repository.js';

function parseArguments(argumentsList) {
  const values = {};

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (argument === '--password-stdin') {
      if (values.passwordStdin) throw new AdminCreationError('invalid_arguments', 'Argumentos no válidos.');
      values.passwordStdin = true;
      continue;
    }

    if (argument === '--username' || argument === '--name') {
      const value = argumentsList[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new AdminCreationError('invalid_arguments', 'Argumentos no válidos.');
      }
      const key = argument === '--username' ? 'username' : 'name';
      if (values[key] !== undefined) {
        throw new AdminCreationError('invalid_arguments', 'Argumentos no válidos.');
      }
      values[key] = value;
      index += 1;
      continue;
    }

    throw new AdminCreationError('invalid_arguments', 'Argumentos no válidos.');
  }

  if (!values.username || !values.name || values.passwordStdin !== true) {
    throw new AdminCreationError('invalid_arguments', 'Argumentos no válidos.');
  }

  return values;
}

async function readStandardInput(input) {
  let value = '';
  input.setEncoding('utf8');

  for await (const chunk of input) {
    value += chunk;
    if (value.length > 1_026) break;
  }

  return value.replace(/\r?\n$/, '');
}

export async function runCreateAdmin({
  argumentsList,
  input,
  output,
  errorOutput,
  createRepository,
  close = async () => {},
}) {
  try {
    const argumentsValues = parseArguments(argumentsList);
    const password = await readStandardInput(input);
    await createAdminAccount({
      repository: createRepository(),
      username: argumentsValues.username,
      name: argumentsValues.name,
      password,
    });
    output.write('Cuenta administradora creada correctamente.\n');
    return 0;
  } catch (error) {
    const message =
      error instanceof AdminCreationError
        ? error.message
        : 'No fue posible crear la cuenta administradora.';
    errorOutput.write(`${message}\n`);
    return 1;
  } finally {
    await close();
  }
}

async function main() {
  let pool;

  const exitCode = await runCreateAdmin({
    argumentsList: process.argv.slice(2),
    input: process.stdin,
    output: process.stdout,
    errorOutput: process.stderr,
    createRepository() {
      const environment = loadEnvironment();
      pool = createDatabasePool(environment.DATABASE_URL);
      return createAuthRepository(pool);
    },
    async close() {
      if (pool) await closeDatabasePool(pool);
    },
  });

  process.exitCode = exitCode;
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  await main();
}

export { parseArguments, readStandardInput };
