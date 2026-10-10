import type { Request } from 'express';
import { z } from 'zod';
import { notFound } from './errors.js';

const idParamSchema = z.object({ id: z.uuid() });

/** Parses the :id route param. A malformed id can't exist, so it's a 404 rather than a 400. */
export function parseId(req: Request, what: string): string {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) throw notFound(what);
  return parsed.data.id;
}

/**
 * Human alphabetical order: case-insensitive, "Item 2" before "Item 10".
 * Used instead of SQL ORDER BY because database sort order depends on how Postgres was
 * installed (some put "Zebra" before "apple"). Lists here are tens-to-hundreds of rows.
 */
export const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Prisma returns NUMERIC columns as Decimal objects; the API sends plain JSON numbers. */
export function num(value: { toString(): string }): number;
export function num(value: { toString(): string } | null): number | null;
export function num(value: { toString(): string } | null): number | null {
  return value === null ? null : Number(value.toString());
}
