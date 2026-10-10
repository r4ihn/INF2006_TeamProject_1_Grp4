import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../src/http/errors.js';

function appThrowing(err: unknown) {
  const app = express();
  app.get('/boom', () => {
    throw err;
  });
  app.use(errorHandler);
  return app;
}

// Shaped like the error Prisma throws when a table doesn't exist.
const tableMissing = Object.assign(new Error('The table `public.organizations` does not exist'), {
  code: 'P2021',
  meta: { driverAdapterError: { cause: { originalCode: '42P01' } } },
});

describe('errorHandler', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('explains missing tables with the command that fixes it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(appThrowing(tableMissing)).get('/boom');

    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({
      code: 'SCHEMA_MISSING',
      message: 'The database tables haven’t been created yet. Run: npm run db:setup',
    });
  });

  it('includes the real cause of a 500 while developing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error(
      'Invalid `prisma.item.findMany()` invocation:\n\n  Connection pool timeout',
    );
    const res = await request(appThrowing(err)).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Server error: Connection pool timeout');
  });

  it('hides the cause in production', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');
    const res = await request(appThrowing(new Error('secret internals'))).get('/boom');

    expect(res.body.error.message).toBe('Something went wrong on the server');
  });
});
