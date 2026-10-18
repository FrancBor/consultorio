import argon2 from 'argon2';
import { HttpError } from '../../middleware/error-handler.js';
import { normalizeUsername } from '../auth/schemas.js';
import { AdminUserRepositoryError } from './repository.js';

function toPublicUser(account) {
  return {
    id: account.id,
    usuario: account.usuario,
    nombre: account.nombre,
    correo: account.correo,
    rol: account.rol,
    activo: account.activo,
    ultimo_acceso_en: account.ultimo_acceso_en,
    creado_en: account.creado_en,
    actualizado_en: account.actualizado_en,
  };
}

function repositoryError(error) {
  if (!(error instanceof AdminUserRepositoryError)) return null;

  const errors = {
    not_found: {
      status: 404,
      code: 'user_not_found',
      message: 'La cuenta solicitada no existe.',
    },
    self_protection: {
      status: 409,
      code: 'self_protection',
      message: 'No puede desactivar ni degradar su propia cuenta.',
    },
    last_active_admin: {
      status: 409,
      code: 'last_active_admin',
      message: 'Debe existir al menos una cuenta administradora activa.',
    },
    auth_version_overflow: {
      status: 409,
      code: 'auth_version_exhausted',
      message: 'La cuenta no admite más cambios de seguridad.',
    },
  };

  return errors[error.code] ?? null;
}

function mapWriteError(error) {
  const mappedRepositoryError = repositoryError(error);
  if (mappedRepositoryError) return new HttpError(mappedRepositoryError);

  if (error?.code === '23505') {
    const duplicateEmail = error.constraint === 'uq_usuarios_correo_lower';
    return new HttpError({
      status: 409,
      code: duplicateEmail ? 'duplicate_email' : 'duplicate_username',
      message: duplicateEmail
        ? 'El correo ya está asociado a otra cuenta.'
        : 'El nombre de usuario ya existe.',
    });
  }

  return error;
}

export function createAdminUsersService({
  repository,
  hashPassword = (password) => argon2.hash(password, { type: argon2.argon2id }),
}) {
  return {
    async list(filters) {
      const result = await repository.list(filters);
      return { total: result.total, users: result.users.map(toPublicUser) };
    },

    async create(input) {
      const passwordHash = await hashPassword(input.password);

      try {
        const user = await repository.create({
          username: normalizeUsername(input.usuario),
          name: input.nombre.trim(),
          email: input.correo?.trim().toLocaleLowerCase('es') ?? null,
          role: input.rol,
          passwordHash,
        });
        return toPublicUser(user);
      } catch (error) {
        throw mapWriteError(error);
      }
    },

    async update({ targetId, actorId, patch }) {
      try {
        const result = await repository.update({
          targetId,
          actorId,
          patch: {
            ...patch,
            ...(patch.nombre === undefined ? {} : { nombre: patch.nombre.trim() }),
          },
        });
        return { ...result, user: toPublicUser(result.user) };
      } catch (error) {
        throw mapWriteError(error);
      }
    },

    async resetPassword({ targetId, password }) {
      const passwordHash = await hashPassword(password);

      try {
        const user = await repository.resetPassword({ targetId, passwordHash });
        return toPublicUser(user);
      } catch (error) {
        throw mapWriteError(error);
      }
    },
  };
}

export { toPublicUser };
