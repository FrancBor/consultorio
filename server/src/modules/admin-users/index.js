import { requireAuthentication, requireRole } from '../../middleware/authentication.js';
import { createAuthRepository } from '../auth/repository.js';
import { createAdminUsersRepository } from './repository.js';
import { createAdminUsersRouter } from './routes.js';
import { createAdminUsersService } from './service.js';

export function createAdminUsersModule({ pool, environment }) {
  const repository = createAdminUsersRepository(pool);
  const service = createAdminUsersService({ repository });
  const authenticationRequired = requireAuthentication(createAuthRepository(pool), {
    cookieName: environment.SESSION_COOKIE_NAME,
    secureCookie: environment.NODE_ENV === 'production',
  });

  return {
    router: createAdminUsersRouter({
      service,
      authenticationRequired,
      adminRequired: requireRole('admin'),
      cookieName: environment.SESSION_COOKIE_NAME,
      secureCookie: environment.NODE_ENV === 'production',
    }),
  };
}
