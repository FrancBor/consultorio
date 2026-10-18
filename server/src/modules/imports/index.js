import { requireAuthentication, requireRole } from '../../middleware/authentication.js';
import { createAuthRepository } from '../auth/repository.js';
import { createImportsRepository } from './repository.js';
import { createImportsRouter } from './routes.js';
import { createImportsService } from './service.js';

export function createImportsModule({ pool, environment }) {
  const repository = createImportsRepository(pool);
  const service = createImportsService(repository);
  const authenticationRequired = requireAuthentication(createAuthRepository(pool), {
    cookieName: environment.SESSION_COOKIE_NAME,
    secureCookie: environment.NODE_ENV === 'production',
  });

  return {
    router: createImportsRouter({
      service,
      authenticationRequired,
      adminRequired: requireRole('admin'),
    }),
  };
}
