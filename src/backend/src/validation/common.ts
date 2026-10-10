import { z } from 'zod';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** Optional text field: "" / "   " / missing → null, otherwise trimmed and length-checked. */
export const optionalText = (max: number) =>
  z.preprocess(
    blankToNull,
    z.string().trim().max(max, `Must be at most ${max} characters`).nullable().optional(),
  );

/** Required text field, trimmed. */
export const requiredText = (label: string, max: number) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `Must be at most ${max} characters`);

/**
 * A non-negative amount with at most `places` decimal places, matching a NUMERIC column
 * (e.g. places=2 for money, 3 for quantities like 2.5 kg).
 */
export const amount = (label: string, places: number, max: number) =>
  z
    .number({ error: `${label} must be a number` })
    .refine(Number.isFinite, `${label} must be a number`)
    .min(0, `${label} cannot be negative`)
    .max(max, `${label} is too large`)
    .refine(
      (v) => Math.abs(v * 10 ** places - Math.round(v * 10 ** places)) < 1e-6,
      `${label} can have at most ${places} decimal place${places === 1 ? '' : 's'}`,
    );

/** Optional id of another record: ""/null → null (i.e. "none"). */
export const optionalId = z.preprocess(
  blankToNull,
  z.uuid('Choose an option from the list').nullable().optional(),
);

/** Query-string boolean: "true" / "1" → true, anything else → false. */
export const queryFlag = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');
