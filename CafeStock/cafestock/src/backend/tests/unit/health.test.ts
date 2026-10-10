import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { DEV_AUTH, loadConfig } from '../../src/config.js';
import type { PrismaClient } from '../../src/db/client.js';

// A stand-in for Prisma: only $queryRaw is used by the health routes.
function fakePrisma(queryRaw: () => Promise<unknown>) {
  return { $queryRaw: vi.fn(queryRaw) } as unknown as PrismaClient;
}

const config = loadConfig({ CORS_ORIGIN: 'http://localhost:5173' });
const app = createApp({ config, prisma: fakePrisma(async () => [{ ready: true }]) });

describe('GET /health (liveness)', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toMatchObject({ status: 'ok', service: 'cafestock-api' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('does not touch the database', async () => {
    const prisma = fakePrisma(async () => {
      throw new Error('db down');
    });
    const res = await request(createApp({ config, prisma })).get('/health');

    expect(res.status).toBe(200);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('allows the Vite dev origin via CORS', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('sets security headers (helmet)', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('GET /health/ready (readiness)', () => {
  it('returns 200 when the database answers', async () => {
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up', tables: 'ok' });
    expect(typeof res.body.latencyMs).toBe('number');
  });

  it('returns 503 when the database is up but the tables were never created', async () => {
    const prisma = fakePrisma(async () => [{ ready: false }]);
    const res = await request(createApp({ config, prisma })).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'error', database: 'up', tables: 'missing' });
  });

  it('returns 503 when the database is down', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const prisma = fakePrisma(async () => {
      throw new Error('connection refused');
    });
    const res = await request(createApp({ config, prisma })).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', database: 'down' });
  });
});

describe('unknown routes', () => {
  it('return a JSON 404', async () => {
    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'No route for GET /does-not-exist' },
    });
  });
});

describe('loadConfig', () => {
  it('uses sensible defaults', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      corsOrigins: ['http://localhost:5173'],
      nodeEnv: 'development',
      databaseUrl: 'postgresql://cafestock:cafestock@localhost:5433/cafestock',
      demoOrgSlug: 'demo-cafe',
      auth: { mode: 'dev', ...DEV_AUTH },
      staticDir: null,
    });
  });

  it('reads STATIC_DIR (the built web app, on AWS)', () => {
    expect(loadConfig({ STATIC_DIR: ' /opt/cafestock/frontend/dist ' }).staticDir).toBe(
      '/opt/cafestock/frontend/dist',
    );
    expect(loadConfig({ STATIC_DIR: '' }).staticDir).toBeNull();
  });

  it('parses a comma-separated CORS list', () => {
    expect(loadConfig({ CORS_ORIGIN: 'http://a.com, http://b.com' }).corsOrigins).toEqual([
      'http://a.com',
      'http://b.com',
    ]);
  });

  it('reads DATABASE_URL', () => {
    expect(loadConfig({ DATABASE_URL: 'postgresql://x@db:5432/y' }).databaseUrl).toBe(
      'postgresql://x@db:5432/y',
    );
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid PORT/);
  });
});
