import { z } from 'zod';

function isCalendarDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate);

const rangeShape = {
  desde: dateSchema,
  hasta: dateSchema,
};

const positiveIntegerSchema = (maximum) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(maximum));

function validateRange(value, context) {
  const start = Date.parse(`${value.desde}T00:00:00Z`);
  const end = Date.parse(`${value.hasta}T00:00:00Z`);
  const differenceDays = (end - start) / 86_400_000;

  if (differenceDays < 0) {
    context.addIssue({ code: 'custom', path: ['hasta'], message: 'Invalid date range' });
  } else if (differenceDays > 365) {
    context.addIssue({ code: 'custom', path: ['hasta'], message: 'Date range exceeds 366 days' });
  }
}

export const indicatorQuerySchema = z.object(rangeShape).strict().superRefine(validateRange);

export const detailQuerySchema = z
  .object({
    ...rangeShape,
    page: positiveIntegerSchema(Number.MAX_SAFE_INTEGER).prefault('1'),
    limit: positiveIntegerSchema(100).prefault('25'),
  })
  .strict()
  .superRefine(validateRange);
