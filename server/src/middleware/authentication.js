import { HttpError } from './error-handler.js';

function serializeAuthVersion(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : null;
}

function authenticationRequiredError() {
  return new HttpError({
    status: 401,
    code: 'authentication_required',
    message: 'Debe iniciar sesión para continuar.',
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

export function requireSessionIdentity(request, _response, next) {
  if (request.session?.userId === undefined) {
    next(authenticationRequiredError());
    return;
  }

  next();
}

export function requireAuthentication(repository, cookieOptions) {
  return async function authenticationMiddleware(request, response, next) {
    const userId = request.session?.userId;

    if (userId === undefined) {
      throw authenticationRequiredError();
    }

    const account = await repository.findActiveById(userId);
    const accountAuthVersion = account ? serializeAuthVersion(account.auth_version) : null;

    if (!account || request.session.authVersion !== accountAuthVersion) {
      try {
        await destroySession(request);
      } finally {
        clearSessionCookie(response, cookieOptions);
      }
      throw authenticationRequiredError();
    }

    request.authUser = {
      id: account.id,
      usuario: account.usuario,
      nombre: account.nombre_mostrar,
      rol: account.rol_codigo,
    };
    next();
  };
}

export function requireRole(requiredRole) {
  return function roleMiddleware(request, _response, next) {
    if (request.authUser?.rol !== requiredRole) {
      next(
        new HttpError({
          status: 403,
          code: 'forbidden',
          message: 'No tiene permisos para realizar esta acción.',
        }),
      );
      return;
    }

    next();
  };
}
