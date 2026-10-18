import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createReadinessCheck } from '../src/db/readiness.js';
import { createHttpLogger, createLogger } from '../src/lib/logger.js';
import { errorHandler } from '../src/middleware/error-handler.js';

function buildApp(query = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] })) {
  return {
    app: createApp({
      readinessCheck: createReadinessCheck({ query }),
      logger: createLogger({ level: 'info', nodeEnv: 'test' }),
    }),
    query,
  };
}

describe('service endpoints', () => {
  it('reports liveness without querying PostgreSQL and includes a request ID', async () => {
    const { app, query } = buildApp();

    const response = await request(app).get('/health').expect(200);

    expect(response.type).toBe('application/json');
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('preserves an incoming request ID', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .get('/health')
      .set('X-Request-Id', 'request-from-client')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('request-from-client');
  });

  it('reports readiness after a successful PostgreSQL check', async () => {
    const { app, query } = buildApp();

    const response = await request(app).get('/ready').expect(200);

    expect(response.body).toEqual({ status: 'ready' });
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns a sanitized stable error when PostgreSQL is unavailable', async () => {
    const sensitiveFailure = new Error(
      'password=do-not-expose while executing SELECT secret_column',
    );
    const { app } = buildApp(vi.fn().mockRejectedValue(sensitiveFailure));

    const response = await request(app).get('/ready').expect(503);

    expect(response.body).toEqual({
      error: {
        code: 'service_unavailable',
        message: 'El servicio no está disponible temporalmente.',
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('do-not-expose');
    expect(JSON.stringify(response.body)).not.toContain('SELECT');
  });

  it('returns the uniform JSON contract for unknown routes', async () => {
    const { app } = buildApp();

    const response = await request(app).get('/missing').expect(404);

    expect(response.body).toEqual({
      error: {
        code: 'not_found',
        message: 'El recurso solicitado no existe.',
      },
    });
    expect(response.headers['x-request-id']).toBeTruthy();
  });
});

describe('error middleware', () => {
  it('converts an unexpected async failure without exposing its stack', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const app = express();
    app.use(createHttpLogger(createLogger({ level: 'info', nodeEnv: 'test' })));
    app.get('/boom', async () => {
      throw new Error('sensitive production detail');
    });
    app.use(errorHandler);

    const response = await request(app).get('/boom').expect(500);

    expect(response.body).toEqual({
      error: {
        code: 'internal_error',
        message: 'Ocurrió un error interno.',
      },
    });
    expect(response.body).not.toHaveProperty('stack');
    expect(JSON.stringify(response.body)).not.toContain('sensitive production detail');
    vi.unstubAllEnvs();
  });
});
