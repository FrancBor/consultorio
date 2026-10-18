import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

function toPublicUser(account) {
  return {
    id: account.id,
    usuario: account.usuario,
    nombre: account.nombre_mostrar,
    rol: account.rol_codigo,
  };
}

function serializeAuthVersion(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error('Invalid account authentication version.');
  }
  return value;
}

export function createAuthService({
  repository,
  verifyPassword = argon2.verify,
  fallbackHashPromise,
}) {
  const safeFallbackHash =
    fallbackHashPromise ??
    argon2.hash(randomBytes(32).toString('base64url'), { type: argon2.argon2id });

  return {
    async authenticate(username, password) {
      const account = await repository.findByUsername(username);
      const passwordHash = account?.password_hash ?? (await safeFallbackHash);
      const passwordMatches = await verifyPassword(passwordHash, password);

      if (!account || !passwordMatches || !account.activo || !account.rol_activo) {
        return null;
      }

      const expectedAuthVersion = serializeAuthVersion(account.auth_version);
      const authVersion = await repository.finalizeSuccessfulLogin({
        userId: account.id,
        authVersion: expectedAuthVersion,
        passwordHash: account.password_hash,
      });

      if (authVersion === undefined) return null;

      return {
        user: toPublicUser(account),
        authVersion: serializeAuthVersion(authVersion),
      };
    },
  };
}

export { serializeAuthVersion, toPublicUser };
