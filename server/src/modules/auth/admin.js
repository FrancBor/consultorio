import argon2 from 'argon2';
import { adminAccountSchema, normalizeUsername } from './schemas.js';

export class AdminCreationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AdminCreationError';
    this.code = code;
  }
}

export async function createAdminAccount({ repository, username, name, password }) {
  const parsed = adminAccountSchema.safeParse({ username, name, password });

  if (!parsed.success) {
    const passwordIssue = parsed.error.issues.some((issue) => issue.path[0] === 'password');
    throw new AdminCreationError(
      passwordIssue ? 'invalid_password' : 'invalid_account',
      passwordIssue
        ? 'La contraseña debe tener entre 12 y 1024 caracteres.'
        : 'El usuario o el nombre no son válidos.',
    );
  }

  const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });

  try {
    return await repository.createAdmin({
      username: normalizeUsername(parsed.data.username),
      name: parsed.data.name.trim(),
      passwordHash,
    });
  } catch (error) {
    if (error?.code === '23505') {
      throw new AdminCreationError('duplicate_username', 'El usuario ya existe.');
    }

    throw error;
  }
}
