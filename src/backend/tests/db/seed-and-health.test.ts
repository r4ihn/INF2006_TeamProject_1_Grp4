import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createPrismaClient } from '../../src/db/client.js';
import { DEMO_ORG, seedDemoOrg } from '../../src/db/seed.js';
import { createTestPrisma, resetData } from './test-db.js';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => resetData(prisma));

describe('seed', () => {
  it('creates the demo organisation', async () => {
    const org = await seedDemoOrg(prisma);

    expect(org).toMatchObject({ slug: 'demo-cafe', name: 'Demo Café' });
    expect(await prisma.organization.count()).toBe(1);
  });

  it('is safe to run more than once', async () => {
    const first = await seedDemoOrg(prisma);
    const second = await seedDemoOrg(prisma);

    expect(second.id).toBe(first.id);
    expect(await prisma.organization.count({ where: { slug: DEMO_ORG.slug } })).toBe(1);
  });
});

describe('GET /health/ready against a real database', () => {
  const config = loadConfig({});

  it('returns 200 when Postgres is reachable', async () => {
    const res = await request(createApp({ config, prisma })).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.database).toBe('up');
  });

  it('returns 503 when Postgres is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = createPrismaClient('postgresql://nobody:wrong@localhost:1/nothing');
    try {
      const res = await request(createApp({ config, prisma: broken })).get('/health/ready');
      expect(res.status).toBe(503);
    } finally {
      await broken.$disconnect();
    }
  });
});
