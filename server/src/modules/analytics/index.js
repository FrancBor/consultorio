import { createAuthRepository } from '../auth/repository.js';
import { requireAuthentication } from '../../middleware/authentication.js';
import { createAnalyticsRepository } from './repository.js';
import { createAnalyticsRouter } from './routes.js';
import { createAnalyticsService } from './service.js';

export function createAnalyticsModule({ pool, environment }) {
  const repository = createAnalyticsRepository(pool);
  const service = createAnalyticsService(repository);
  const authRepository = createAuthRepository(pool);
  const authenticationRequired = requireAuthentication(authRepository, {
    cookieName: environment.SESSION_COOKIE_NAME,
    secureCookie: environment.NODE_ENV === 'production',
  });

  return {
    router: createAnalyticsRouter({ service, authenticationRequired }),
  };
}
