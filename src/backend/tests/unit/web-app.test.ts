import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { PrismaClient } from '../../src/db/client.js';

// A tiny stand-in for frontend/dist
const dist = mkdtempSync(path.join(tmpdir(), 'cafestock-web-'));
mkdirSync(path.join(dist, 'assets'));
writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>CafeStock</title>');
writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
writeFileSync(path.join(dist, 'startup-guard.js'), '/* guard */');

const prisma = { $queryRaw: vi.fn(async () => [{ ready: true }]) } as unknown as PrismaClient;
const cognito = {
  COGNITO_USER_POOL_ID: 'us-east-1_AbC123',
  COGNITO_CLIENT_ID: 'client',
  NODE_ENV: 'production',
};
const app = createApp({ config: loadConfig({ ...cognito, STATIC_DIR: dist }), prisma });

describe('serving the web app (production, STATIC_DIR set)', () => {
  it('serves index.html for the app’s pages, never cached', async () => {
    for (const page of ['/', '/stock', '/forecast?item=abc']) {
      const res = await request(app).get(page).set('Accept', 'text/html');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<title>CafeStock</title>');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('lets browsers cache the hashed assets for a year', async () => {
    const res = await request(app).get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('serves other files from the build (e.g. the startup guard script)', async () => {
    const res = await request(app).get('/startup-guard.js');
    expect(res.status).toBe(200);
    expect(res.text).toBe('/* guard */');
  });

  it('keeps API, health and missing files as JSON errors, not the page', async () => {
    const api = await request(app).get('/api/nope').set('Accept', 'text/html');
    expect(api.status).toBe(401); // /api needs sign-in, even for unknown paths
    const missing = await request(app).get('/assets/missing.js');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    const health = await request(app).get('/health');
    expect(health.body.status).toBe('ok');
    const json = await request(app).get('/something').set('Accept', 'application/json');
    expect(json.status).toBe(404);
  });

  it('sends a Content-Security-Policy that allows Cognito sign-in and nothing else', async () => {
    const csp = (await request(app).get('/')).headers['content-security-policy'] as string;
    expect(csp).toContain("connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});

describe('without STATIC_DIR (development)', () => {
  it('serves no pages — Vite does that', async () => {
    const dev = createApp({ config: loadConfig({}), prisma });
    const res = await request(dev).get('/stock').set('Accept', 'text/html');
    expect(res.status).toBe(404);
    const csp = (await request(dev).get('/health')).headers['content-security-policy'] as string;
    expect(csp).toMatch(/connect-src 'self'(;|$)/);
  });
});
