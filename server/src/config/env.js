import { config as loadDotEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultEnvPath = resolve(moduleDirectory, '..', '..', '.env');

const portSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(0).max(65_535));

const boundedIntegerSchema = (minimum, maximum) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));

const explicitBooleanSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const databaseUrlSchema = z.string().trim().min(1).superRefine((value, context) => {
  try {
    const url = new URL(value);

    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      context.addIssue({ code: 'custom', message: 'Unsupported database protocol' });
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'Invalid database URL' });
  }
});

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: portSchema.default('3000'),
  DATABASE_URL: databaseUrlSchema,
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  SESSION_SECRET: z.string().min(32).refine((value) => value.trim().length >= 32),
  SESSION_COOKIE_NAME: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/)
    .default('consultorio.sid'),
  SESSION_TTL_HOURS: boundedIntegerSchema(1, 168).prefault('8'),
  TRUST_PROXY: explicitBooleanSchema,
});

export class ConfigurationError extends Error {
  constructor(fields) {
    super('La configuración del servidor es inválida.');
    this.name = 'ConfigurationError';
    this.fields = Object.freeze(fields);
  }
}

export function parseEnvironment(source) {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigurationError(fields);
  }

  return Object.freeze(result.data);
}

export function loadEnvironment({ source, envPath = defaultEnvPath } = {}) {
  if (source === undefined) {
    loadDotEnv({ path: envPath, quiet: true });
  }

  return parseEnvironment(source ?? process.env);
}
