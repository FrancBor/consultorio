import { Router } from 'express';
import { HttpError } from '../../middleware/error-handler.js';
import { requireCsrf } from '../auth/csrf.js';
import {
  createUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
  userIdParamsSchema,
} from './schemas.js';

function validationError(message) {
  return new HttpError({ status: 400, code: 'validation_error', message });
}

function parse(schema, value, message) {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(message);
  return result.data;
}

function clearSessionCookie(response, { cookieName, secureCookie }) {
  response.clearCookie(cookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookie,
    path: '/',
  });
}

export function createAdminUsersRouter({
  service,
  authenticationRequired,
  adminRequired,
  cookieName,
  secureCookie,
}) {
  const router = Router();
  router.use(authenticationRequired, adminRequired);

  router.get('/', async (request, response) => {
    const filters = parse(
      listUsersQuerySchema,
      request.query,
      'Los filtros de usuarios no son válidos.',
    );
    const result = await service.list(filters);

    response.status(200).json({
      data: { users: result.users },
      meta: {
        page: filters.page,
        limit: filters.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / filters.limit),
      },
    });
  });

  router.post('/', requireCsrf, async (request, response) => {
    const input = parse(createUserSchema, request.body, 'Los datos de la cuenta no son válidos.');
    const user = await service.create(input);
    response.status(201).json({ data: { user } });
  });

  router.patch('/:id', requireCsrf, async (request, response) => {
    const { id } = parse(userIdParamsSchema, request.params, 'El identificador no es válido.');
    const patch = parse(
      updateUserSchema,
      request.body,
      'Debe indicar al menos un cambio válido.',
    );
    const result = await service.update({
      targetId: id,
      actorId: request.authUser.id,
      patch,
    });
    response.status(200).json({ data: { user: result.user } });
  });

  router.post('/:id/password', requireCsrf, async (request, response) => {
    const { id } = parse(userIdParamsSchema, request.params, 'El identificador no es válido.');
    const input = parse(
      resetPasswordSchema,
      request.body,
      'La contraseña debe tener entre 12 y 1024 caracteres.',
    );
    const user = await service.resetPassword({ targetId: id, password: input.password });

    if (String(id) === String(request.authUser.id)) {
      clearSessionCookie(response, { cookieName, secureCookie });
    }

    response.status(200).json({ data: { user } });
  });

  return router;
}

export { parse };
