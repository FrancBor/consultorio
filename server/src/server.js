import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { ConfigurationError, loadEnvironment } from './config/env.js';
import { closeDatabasePool, createDatabasePool } from './db/pool.js';
import { createReadinessCheck } from './db/readiness.js';
import { createLogger } from './lib/logger.js';
import { createAuthModule } from './modules/auth/index.js';
import { createAnalyticsModule } from './modules/analytics/index.js';
import { createAdminUsersModule } from './modules/admin-users/index.js';
import { createImportsModule } from './modules/imports/index.js';

async function closeHttpServer(httpServer) {
  await new Promise((resolveClose, rejectClose) => {
    httpServer.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        rejectClose(error);
        return;
      }

      resolveClose();
    });
  });
}

export function createShutdown({ httpServer, pool, logger, sessionStore }) {
  let shutdownPromise;

  return function shutdown(signal = 'shutdown') {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      logger.info({ signal }, 'Shutting down server');

      let shutdownError;

      try {
        await closeHttpServer(httpServer);
      } catch (error) {
        shutdownError = error;
      }

      try {
        await sessionStore?.close();
      } catch (error) {
        shutdownError ??= error;
      }

      try {
        await closeDatabasePool(pool);
      } catch (error) {
        shutdownError ??= error;
      }

      if (shutdownError) {
        logger.error({ errorType: shutdownError.name }, 'Server shutdown failed');
        process.exitCode = 1;
        throw shutdownError;
      }

      logger.info('Server shutdown completed');
    })();

    return shutdownPromise;
  };
}

async function listen(app, port) {
  const httpServer = app.listen(port);
  await once(httpServer, 'listening');
  return httpServer;
}

export async function startServer({ environment = loadEnvironment() } = {}) {
  const logger = createLogger({
    level: environment.LOG_LEVEL,
    nodeEnv: environment.NODE_ENV,
  });
  const pool = createDatabasePool(environment.DATABASE_URL);

  pool.on('error', () => {
    logger.error('Unexpected idle PostgreSQL client error');
  });

  const auth = createAuthModule({ pool, environment, logger });
  const analytics = createAnalyticsModule({ pool, environment });
  const adminUsers = createAdminUsersModule({ pool, environment });
  const imports = createImportsModule({ pool, environment });
  const app = createApp({
    readinessCheck: createReadinessCheck(pool),
    logger,
    auth,
    analytics,
    adminUsers,
    imports,
    trustProxy: environment.TRUST_PROXY,
  });

  let httpServer;

  try {
    httpServer = await listen(app, environment.PORT);
  } catch {
    await auth.sessionStore.close();
    await closeDatabasePool(pool);
    throw new Error('No fue posible abrir el puerto HTTP.');
  }

  const shutdown = createShutdown({
    httpServer,
    pool,
    logger,
    sessionStore: auth.sessionStore,
  });
  process.once('SIGINT', () => void shutdown('SIGINT').catch(() => {}));
  process.once('SIGTERM', () => void shutdown('SIGTERM').catch(() => {}));

  const address = httpServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : environment.PORT;
  logger.info({ port }, 'Server listening');

  return { app, httpServer, pool, shutdown };
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  try {
    await startServer();
  } catch (error) {
    const fields = error instanceof ConfigurationError ? ` (${error.fields.join(', ')})` : '';
    console.error(`No fue posible iniciar el servidor.${fields}`);
    process.exitCode = 1;
  }
}
