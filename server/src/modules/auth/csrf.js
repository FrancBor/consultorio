import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../middleware/error-handler.js';

export function createCsrfToken() {
  return randomBytes(32).toString('base64url');
}

export function rotateCsrfToken(request) {
  const token = createCsrfToken();
  request.session.csrfToken = token;
  return token;
}

function digestToken(token) {
  return createHash('sha256').update(token).digest();
}

export function tokensMatch(expected, supplied) {
  if (typeof expected !== 'string' || typeof supplied !== 'string') {
    return false;
  }

  return timingSafeEqual(digestToken(expected), digestToken(supplied));
}

export function requireCsrf(request, _response, next) {
  const suppliedToken = request.get('X-CSRF-Token');

  if (!tokensMatch(request.session?.csrfToken, suppliedToken)) {
    next(
      new HttpError({
        status: 403,
        code: 'invalid_csrf',
        message: 'El token CSRF no es válido.',
      }),
    );
    return;
  }

  next();
}
