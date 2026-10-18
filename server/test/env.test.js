import { describe, expect, it } from 'vitest';
import { ConfigurationError, parseEnvironment } from '../src/config/env.js';

describe('environment configuration', () => {
  it('parses a valid configuration into typed values', () => {
    const environment = parseEnvironment({
      NODE_ENV: 'test',
      PORT: '0',
      DATABASE_URL: 'postgresql://consultorio_app:change_me@localhost/consultorio_test',
      LOG_LEVEL: 'silent',
      SESSION_SECRET: 'a-secure-session-secret-with-32-chars',
      TRUST_PROXY: 'false',
    });

    expect(environment).toEqual({
      NODE_ENV: 'test',
      PORT: 0,
      DATABASE_URL: 'postgresql://consultorio_app:change_me@localhost/consultorio_test',
      LOG_LEVEL: 'silent',
      SESSION_SECRET: 'a-secure-session-secret-with-32-chars',
      SESSION_COOKIE_NAME: 'consultorio.sid',
      SESSION_TTL_HOURS: 8,
      TRUST_PROXY: false,
    });
  });

  it('rejects invalid values without including their contents', () => {
    const source = {
      NODE_ENV: 'production',
      PORT: 'not-a-port',
      DATABASE_URL: 'mysql://consultorio_app:top-secret@localhost/consultorio',
      LOG_LEVEL: 'verbose',
      SESSION_SECRET: 'short',
      SESSION_TTL_HOURS: '0',
      TRUST_PROXY: 'yes',
    };

    let thrown;

    try {
      parseEnvironment(source);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect(thrown.fields).toEqual([
      'PORT',
      'DATABASE_URL',
      'LOG_LEVEL',
      'SESSION_SECRET',
      'SESSION_TTL_HOURS',
      'TRUST_PROXY',
    ]);
    expect(thrown.message).toBe('La configuración del servidor es inválida.');
    expect(JSON.stringify(thrown)).not.toContain('top-secret');
  });

  it('requires DATABASE_URL', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'test' })).toThrow(ConfigurationError);
  });

  it('parses explicit proxy and bounded session settings', () => {
    const environment = parseEnvironment({
      DATABASE_URL: 'postgresql://localhost/consultorio_test',
      SESSION_SECRET: 'another-secure-session-secret-value',
      SESSION_COOKIE_NAME: 'custom.sid',
      SESSION_TTL_HOURS: '24',
      TRUST_PROXY: 'true',
    });

    expect(environment.SESSION_COOKIE_NAME).toBe('custom.sid');
    expect(environment.SESSION_TTL_HOURS).toBe(24);
    expect(environment.TRUST_PROXY).toBe(true);
  });
});
