import express from 'express';
import { createHttpLogger } from './lib/logger.js';
import { errorHandler, HttpError } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';

export function createApp({
  readinessCheck,
  logger,
  auth,
  analytics,
  adminUsers,
  imports,
  trustProxy = false,
}) {
  if (typeof readinessCheck !== 'function') {
    throw new TypeError('readinessCheck must be a function');
  }

  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy ? 1 : false);
  app.use(createHttpLogger(logger));
  app.use(express.json({ limit: '1mb' }));

  if (auth) {
    app.use(auth.sessionMiddleware);
  }

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.get('/ready', async (_request, response) => {
    try {
      await readinessCheck();
    } catch (error) {
      throw new HttpError({
        status: 503,
        code: 'service_unavailable',
        message: 'El servicio no está disponible temporalmente.',
        cause: error,
      });
    }

    response.status(200).json({ status: 'ready' });
  });

  if (auth) {
    app.use('/api/v1/auth', auth.router);
  }

  if (adminUsers) {
    app.use('/api/v1/admin/usuarios', adminUsers.router);
  }

  if (imports) {
    app.use('/api/v1/admin/importaciones', imports.router);
  }

  if (analytics) {
    app.use('/api/v1', analytics.router);
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
