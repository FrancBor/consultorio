import { z } from 'zod';

export const loginSchema = z
  .object({
    usuario: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(1_024),
  })
  .strict();

export const adminAccountSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^[a-zA-Z0-9._-]+$/),
  name: z.string().trim().min(2).max(150),
  password: z.string().min(12).max(1_024),
});

export function normalizeUsername(username) {
  return username.trim().toLocaleLowerCase('es');
}
