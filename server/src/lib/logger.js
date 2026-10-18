import { randomUUID } from 'node:crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';

const redactedPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'req.body.usuario',
  'req.body.username',
  'req.body.password',
  'req.body.password_hash',
  'req.body.*.password',
  'req.body.*.password_hash',
  'password',
  'password_hash',
  '*.password',
  '*.password_hash',
  'csrfToken',
  '*.csrfToken',
];

const sensitiveKeys = new Set([
  'authorization',
  'cookie',
  'databaseurl',
  'hash',
  'setcookie',
  'username',
  'usuario',
]);

function isSensitiveKey(key) {
  const normalizedKey = key.replaceAll(/[^a-zA-Z0-9]/g, '').toLowerCase();

  return (
    sensitiveKeys.has(normalizedKey) ||
    normalizedKey.includes('password') ||
    normalizedKey.includes('secret') ||
    normalizedKey.includes('token') ||
    normalizedKey.endsWith('hash')
  );
}

export function sanitizeForLogging(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  if (value instanceof Date || value instanceof RegExp || ArrayBuffer.isView(value)) {
    return value;
  }

  const sanitized = Array.isArray(value) ? [] : {};
  seen.set(value, sanitized);

  for (const [key, nestedValue] of Object.entries(value)) {
    sanitized[key] = isSensitiveKey(key)
      ? '[REDACTED]'
      : sanitizeForLogging(nestedValue, seen);
  }

  return sanitized;
}

function protectChildBindings(logger, createChild = logger.child) {

  logger.child = function child(bindings, options) {
    const childLogger = createChild.call(this, sanitizeForLogging(bindings), options);
    return protectChildBindings(childLogger, createChild);
  };

  return logger;
}

export function createLogger({ level, nodeEnv }, destination) {
  return protectChildBindings(
    pino(
      {
        level: nodeEnv === 'test' ? 'silent' : level,
        redact: {
          paths: redactedPaths,
          censor: '[REDACTED]',
        },
        formatters: {
          log: sanitizeForLogging,
        },
      },
      destination,
    ),
  );
}

export function createHttpLogger(logger) {
  return pinoHttp({
    logger,
    genReqId(request, response) {
      const incomingId = request.headers['x-request-id'];
      const requestId =
        typeof incomingId === 'string' && incomingId.trim() !== ''
          ? incomingId
          : randomUUID();

      response.setHeader('X-Request-Id', requestId);
      return requestId;
    },
    customLogLevel(_request, response, error) {
      if (error || response.statusCode >= 500) {
        return 'error';
      }

      if (response.statusCode >= 400) {
        return 'warn';
      }

      return 'info';
    },
  });
}
