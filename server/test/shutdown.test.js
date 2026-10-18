import { describe, expect, it, vi } from 'vitest';
import { closeDatabasePool } from '../src/db/pool.js';
import { createShutdown } from '../src/server.js';

describe('resource shutdown', () => {
  it('closes a database pool explicitly', async () => {
    const pool = { end: vi.fn().mockResolvedValue(undefined) };

    await closeDatabasePool(pool);

    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('closes the HTTP server and pool only once', async () => {
    const httpServer = {
      close: vi.fn((callback) => callback()),
    };
    const pool = { end: vi.fn().mockResolvedValue(undefined) };
    const sessionStore = { close: vi.fn().mockResolvedValue(undefined) };
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const shutdown = createShutdown({ httpServer, pool, logger, sessionStore });

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

    expect(httpServer.close).toHaveBeenCalledOnce();
    expect(sessionStore.close).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
