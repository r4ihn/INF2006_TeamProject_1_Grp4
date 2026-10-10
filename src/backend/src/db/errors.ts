// Postgres error codes we care about (https://www.postgresql.org/docs/current/errcodes-appendix.html)
export const PG = {
  NOT_NULL_VIOLATION: '23502',
  FOREIGN_KEY_VIOLATION: '23503',
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  /** Table doesn't exist — usually "migrations were never applied" */
  UNDEFINED_TABLE: '42P01',
} as const;

/**
 * Name of the constraint or index a Postgres error is about, e.g. "items_org_id_sku_key".
 * Lets a route tell *which* unique rule was broken (duplicate name vs duplicate SKU).
 */
export function pgConstraint(err: unknown): string | undefined {
  const cause = (
    err as {
      meta?: { driverAdapterError?: { cause?: { constraint?: unknown } } };
    }
  )?.meta?.driverAdapterError?.cause;
  const c = cause?.constraint as { index?: string; fields?: string[] } | string | undefined;
  if (typeof c === 'string') return c;
  if (c?.index) return c.index;
  if (c?.fields) return c.fields.join(',');
  return (err as { constraint?: string })?.constraint; // plain pg error
}

/**
 * Extracts the Postgres SQLSTATE code from an error thrown by Prisma (through the pg
 * driver adapter) or by `pg` directly. Returns undefined for non-database errors.
 * Later tasks use this to turn e.g. a duplicate supplier name into a 409 response.
 */
export function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as {
    code?: unknown;
    meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } };
    cause?: { originalCode?: unknown; code?: unknown };
  };

  // Prisma's own codes (P2002, P2025…) look like SQLSTATEs, so never read them as one.
  const isPrismaCode = (c: unknown) => typeof c === 'string' && /^P\d{4}$/.test(c);
  const candidates = [
    e.meta?.driverAdapterError?.cause?.originalCode, // Prisma known request error
    e.cause?.originalCode, // Prisma raw query error
    isPrismaCode(e.cause?.code) ? undefined : e.cause?.code,
    isPrismaCode(e.code) ? undefined : e.code, // pg error
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c)) return c;
  }

  // Last resort: Prisma raw-query errors sometimes only include it in the message.
  const message = err instanceof Error ? err.message : '';
  return message.match(/\bCode: `?([0-9A-Z]{5})`?/)?.[1];
}
