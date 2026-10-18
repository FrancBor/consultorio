import { z } from 'zod';

const positiveInteger = (maximum) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().max(maximum));

export const listImportsQuerySchema = z
  .object({
    page: positiveInteger(Number.MAX_SAFE_INTEGER).prefault('1'),
    limit: positiveInteger(100).prefault('20'),
  })
  .strict();

export const importIdParamsSchema = z
  .object({
    id: z
      .string()
      .refine(
        (value) =>
          /^[1-9]\d{0,18}$/.test(value) &&
          BigInt(value) <= 9_223_372_036_854_775_807n,
      ),
  })
  .strict();
