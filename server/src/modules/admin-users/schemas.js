import { z } from 'zod';

const roleSchema = z.enum(['admin', 'consulta']);
const passwordSchema = z.string().min(12).max(1_024);
const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[a-zA-Z0-9._-]+$/);
const nameSchema = z.string().trim().min(2).max(150);
const positiveInteger = (maximum) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().max(maximum));

const optionalEmailSchema = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.string().trim().email().max(254).optional(),
);

export const listUsersQuerySchema = z
  .object({
    page: positiveInteger(Number.MAX_SAFE_INTEGER).prefault('1'),
    limit: positiveInteger(100).prefault('20'),
    search: z.string().trim().min(1).max(150).optional(),
    role: roleSchema.optional(),
    active: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

export const userIdParamsSchema = z
  .object({ id: z.string().regex(/^[1-9]\d{0,18}$/) })
  .strict();

export const createUserSchema = z
  .object({
    usuario: usernameSchema,
    nombre: nameSchema,
    correo: optionalEmailSchema,
    rol: roleSchema,
    password: passwordSchema,
  })
  .strict();

export const updateUserSchema = z
  .object({
    nombre: nameSchema.optional(),
    rol: roleSchema.optional(),
    activo: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const resetPasswordSchema = z
  .object({ password: passwordSchema })
  .strict();

export { roleSchema };
