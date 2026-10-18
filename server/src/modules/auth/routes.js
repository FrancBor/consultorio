import { Router } from 'express';
import { HttpError } from '../../middleware/error-handler.js';
import {
  requireAuthentication,
  requireSessionIdentity,
} from '../../middleware/authentication.js';
import { requireCsrf, rotateCsrfToken } from './csrf.js';
import { loginSchema, normalizeUsername } from './schemas.js';

const invalidCredentialsError = () =>
  new HttpError({
    status: 401,
    code: 'invalid_credentials',
    message: 'Usuario o contraseña incorrectos.',
  });

function regenerateSession(request) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function saveSession(request) {
  return new Promise((resolve, reject) => {
    request.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(request) {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function clearSessionCookie(response, { cookieName, secureCookie }) {
  response.clearCookie(cookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookie,
    path: '/',
  });
}

async function discardRegeneratedSession(request, response, cookieOptions) {
  try {
    await destroySession(request);
  } catch {
    request.session = null;
  }

  clearSessionCookie(response, cookieOptions);
}

export function createAuthRouter({
  authService,
  repository,
  loginLimiter,
  cookieName,
  secureCookie,
}) {
  const router = Router();
  const authenticationRequired = requireAuthentication(repository, {
    cookieName,
    secureCookie,
  });

  router.get('/csrf', (request, response) => {
    response.status(200).json({ csrfToken: rotateCsrfToken(request) });
  });

  router.post('/login', loginLimiter, requireCsrf, async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      throw new HttpError({
        status: 400,
        code: 'validation_error',
        message: 'Los datos de inicio de sesión no son válidos.',
      });
    }

    const authentication = await authService.authenticate(
      normalizeUsername(parsed.data.usuario),
      parsed.data.password,
    );

    if (!authentication) {
      throw invalidCredentialsError();
    }

    const { user, authVersion } = authentication;

    let csrfToken;

    try {
      await regenerateSession(request);
      request.session.userId = user.id;
      request.session.authVersion = authVersion;
      csrfToken = rotateCsrfToken(request);
      await saveSession(request);
    } catch (error) {
      if (request.session) {
        await discardRegeneratedSession(request, response, { cookieName, secureCookie });
      }
      throw error;
    }

    response.status(200).json({ user, csrfToken });
  });

  router.get('/me', authenticationRequired, (request, response) => {
    response.status(200).json({ user: request.authUser });
  });

  router.post(
    '/logout',
    requireSessionIdentity,
    requireCsrf,
    async (request, response) => {
      await destroySession(request);
      clearSessionCookie(response, { cookieName, secureCookie });
      response.status(204).end();
    },
  );

  return router;
}
