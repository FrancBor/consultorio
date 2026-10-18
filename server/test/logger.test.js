import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/lib/logger.js';

describe('structured logger', () => {
  it('is silent in the test environment regardless of the configured level', () => {
    const destination = { write: vi.fn() };
    const logger = createLogger({ level: 'trace', nodeEnv: 'test' }, destination);

    logger.info('not written');

    expect(logger.level).toBe('silent');
    expect(destination.write).not.toHaveBeenCalled();
  });

  it('redacts sensitive request, response, and password fields', () => {
    const lines = [];
    const destination = { write: (line) => lines.push(line) };
    const logger = createLogger({ level: 'info', nodeEnv: 'production' }, destination);

    logger.info({
      req: {
        headers: {
          authorization: 'Bearer private-token',
          cookie: 'session=private-cookie',
          'x-csrf-token': 'private-csrf-token',
        },
        body: { usuario: 'private-username', password: 'private-password' },
      },
      res: { headers: { 'set-cookie': 'session=private-session' } },
      account: { password_hash: 'private-hash' },
    });

    const serialized = lines.join('');

    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('private-token');
    expect(serialized).not.toContain('private-cookie');
    expect(serialized).not.toContain('private-csrf-token');
    expect(serialized).not.toContain('private-username');
    expect(serialized).not.toContain('private-password');
    expect(serialized).not.toContain('private-session');
    expect(serialized).not.toContain('private-hash');
  });

  it('recursively redacts configuration, hashes, and nested passwords with cycles', () => {
    const lines = [];
    const destination = { write: (line) => lines.push(line) };
    const logger = createLogger({ level: 'info', nodeEnv: 'production' }, destination);
    const secrets = {
      sessionSecret: 'private-session-secret',
      databaseUrl: 'private-database-url',
      passwordHash: 'private-password-hash',
      hash: 'private-generic-hash',
      nestedPassword: 'private-nested-password',
    };
    const cyclic = {
      SESSION_SECRET: secrets.sessionSecret,
      nested: {
        DATABASE_URL: secrets.databaseUrl,
        passwordHash: secrets.passwordHash,
        hash: secrets.hash,
        deeper: [{ password: secrets.nestedPassword }],
      },
    };
    cyclic.self = cyclic;

    expect(() => logger.info({ config: cyclic })).not.toThrow();

    const serialized = lines.join('');
    expect(serialized).toContain('[REDACTED]');
    for (const secret of Object.values(secrets)) {
      expect(serialized).not.toContain(secret);
    }
    expect(cyclic.SESSION_SECRET).toBe(secrets.sessionSecret);
    expect(cyclic.self).toBe(cyclic);
  });

  it('recursively redacts direct child bindings without mutating cyclic input', () => {
    const lines = [];
    const destination = { write: (line) => lines.push(line) };
    const logger = createLogger({ level: 'info', nodeEnv: 'production' }, destination);
    const secrets = {
      sessionSecret: 'child-session-secret',
      databaseUrl: 'child-database-url',
      passwordHash: 'child-password-hash',
      hash: 'child-generic-hash',
      nestedPassword: 'child-nested-password',
    };
    const bindings = {
      config: {
        SESSION_SECRET: secrets.sessionSecret,
        DATABASE_URL: secrets.databaseUrl,
        passwordHash: secrets.passwordHash,
        hash: secrets.hash,
        nested: { password: secrets.nestedPassword },
      },
    };
    bindings.config.self = bindings.config;

    expect(() => logger.child(bindings).info({ event: 'direct-child' })).not.toThrow();

    const serialized = lines.join('');
    expect(serialized).toContain('[REDACTED]');
    for (const secret of Object.values(secrets)) {
      expect(serialized).not.toContain(secret);
    }
    expect(bindings.config.SESSION_SECRET).toBe(secrets.sessionSecret);
    expect(bindings.config.nested.password).toBe(secrets.nestedPassword);
    expect(bindings.config.self).toBe(bindings.config);
  });

  it('keeps recursive binding redaction in nested child loggers', () => {
    const lines = [];
    const destination = { write: (line) => lines.push(line) };
    const logger = createLogger({ level: 'info', nodeEnv: 'production' }, destination);
    const parentBindings = {
      component: 'auth',
      config: { SESSION_SECRET: 'nested-parent-secret' },
    };
    const childBindings = {
      requestId: 'request-1',
      credentials: {
        DATABASE_URL: 'nested-child-database-url',
        passwordHash: 'nested-child-password-hash',
        hash: 'nested-child-generic-hash',
        deeper: { password: 'nested-child-password' },
      },
    };

    const nested = logger
      .child(parentBindings, { level: 'debug' })
      .child(childBindings, { msgPrefix: 'nested: ' });

    expect(nested.bindings()).toMatchObject({
      component: 'auth',
      requestId: 'request-1',
    });
    expect(nested.level).toBe('debug');
    expect(nested.child).toHaveLength(2);

    nested.info('child-event');

    const serialized = lines.join('');
    const record = JSON.parse(lines[0]);
    expect(record.component).toBe('auth');
    expect(record.requestId).toBe('request-1');
    expect(record.msg).toBe('nested: child-event');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('nested-parent-secret');
    expect(serialized).not.toContain('nested-child-database-url');
    expect(serialized).not.toContain('nested-child-password-hash');
    expect(serialized).not.toContain('nested-child-generic-hash');
    expect(serialized).not.toContain('nested-child-password');
    expect(parentBindings.component).toBe('auth');
    expect(parentBindings.config.SESSION_SECRET).toBe('nested-parent-secret');
    expect(childBindings.requestId).toBe('request-1');
    expect(childBindings.credentials.deeper.password).toBe('nested-child-password');
  });
});
