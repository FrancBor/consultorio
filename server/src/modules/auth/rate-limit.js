import { createHash } from 'node:crypto';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

function loginKey(request) {
  const rawUsername = request.body?.usuario;
  const normalizedUsername =
    typeof rawUsername === 'string'
      ? rawUsername.trim().toLocaleLowerCase('es').slice(0, 100)
      : '';
  const usernameDigest = createHash('sha256').update(normalizedUsername).digest('hex');
  const ipAddress = ipKeyGenerator(request.ip ?? '0.0.0.0', 56);

  return `${ipAddress}:${usernameDigest}`;
}

export function createLoginRateLimiter({ windowMs = 15 * 60 * 1_000, limit = 5 } = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: loginKey,
    handler(_request, response) {
      response.status(429).json({
        error: {
          code: 'rate_limit_exceeded',
          message: 'Demasiados intentos de inicio de sesión. Intente más tarde.',
        },
      });
    },
  });
}

export { loginKey };
