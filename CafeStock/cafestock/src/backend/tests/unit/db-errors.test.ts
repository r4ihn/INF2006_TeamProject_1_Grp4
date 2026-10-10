import { describe, expect, it } from 'vitest';
import { PG, pgErrorCode } from '../../src/db/errors.js';

describe('pgErrorCode', () => {
  it('reads the code from a Prisma known-request error', () => {
    const err = Object.assign(new Error('Foreign key constraint violated'), {
      code: 'P2003',
      meta: { driverAdapterError: { cause: { originalCode: '23503' } } },
    });
    expect(pgErrorCode(err)).toBe(PG.FOREIGN_KEY_VIOLATION);
  });

  it('reads the code from a plain pg error', () => {
    expect(pgErrorCode(Object.assign(new Error('dup'), { code: '23505' }))).toBe(
      PG.UNIQUE_VIOLATION,
    );
  });

  it('falls back to the message of a raw-query error', () => {
    expect(pgErrorCode(new Error('Database error. Code: `23514`. Message: …'))).toBe(
      PG.CHECK_VIOLATION,
    );
  });

  it('ignores Prisma-only codes and non-errors', () => {
    expect(pgErrorCode(Object.assign(new Error('x'), { code: 'P2025' }))).toBeUndefined();
    expect(pgErrorCode('boom')).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
  });
});
