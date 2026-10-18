import { createAuthRepository } from './repository.js';
import { createLoginRateLimiter } from './rate-limit.js';
import { createAuthRouter } from './routes.js';
import { createAuthService } from './service.js';
import { createSessionRuntime } from './session.js';

export function createAuthModule({ pool, environment, logger, loginLimiter }) {
  const repository = createAuthRepository(pool);
  const authService = createAuthService({ repository });
  const sessionRuntime = createSessionRuntime({ pool, environment, logger });
  const router = createAuthRouter({
    authService,
    repository,
    loginLimiter: loginLimiter ?? createLoginRateLimiter(),
    cookieName: environment.SESSION_COOKIE_NAME,
    secureCookie: environment.NODE_ENV === 'production',
  });

  return {
    router,
    sessionMiddleware: sessionRuntime.middleware,
    sessionStore: sessionRuntime.store,
  };
}
