import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { testAuthenticator } from './test-auth.js';
import { createTestPrisma, makeOrg, resetData } from './test-db.js';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());
const app = createApp({ config: loadConfig({}), prisma, authenticate: testAuthenticator });

let orgA: string;
let orgB: string;
beforeEach(async () => {
  await resetData(prisma);
  orgA = (await makeOrg(prisma, 'Cafe A')).id;
  orgB = (await makeOrg(prisma, 'Cafe B')).id;
});

const as = (orgId: string, role = 'MANAGER') => ({ 'x-test-org': orgId, 'x-test-role': role });
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

const rec = (overrides: Record<string, unknown> = {}) => ({
  onHand: 50,
  leadTimeDays: 2,
  avgDailyDemand: 10,
  demandStdDev: 2.138,
  leadTimeDemand: 20,
  safetyStock: 4.989,
  reorderPoint: 24.989,
  shortfall: 0,
  reviewDemand: 70,
  orderUpTo: 94.989,
  recommendedQty: 0,
  coverDays: 5,
  itemMase: 0.8123,
  itemMape: 0.25,
  historyDays: 60,
  status: 'OK' as const,
  ...overrides,
});

/** A café with two items, a finished run for them and some demand history. */
async function seedRun(
  orgId: string,
  { startedAt = new Date('2026-09-26T01:00:00Z'), status = 'SUCCEEDED' as const } = {},
) {
  const milk = await prisma.item.create({
    data: { orgId, name: 'Fresh milk', category: 'Chiller', unit: 'ml' },
  });
  const cups = await prisma.item.create({
    data: { orgId, name: 'Paper cup', category: 'Dry', unit: 'pcs' },
  });
  const run = await prisma.forecastRun.create({
    data: {
      orgId,
      modelTag: 'lgbm-v1',
      modelKind: 'ML',
      status,
      baselineTag: 'baseline-ma14',
      forecastFrom: day('2025-03-24'),
      maseModel: 1.0878,
      maseBaseline: 1.1261,
      mapeModel: 0.456,
      mapeBaseline: 0.5034,
      itemsProcessed: 2,
      startedAt,
      finishedAt: startedAt,
    },
  });
  await prisma.reorderRecommendation.createMany({
    data: [
      { orgId, runId: run.id, itemId: milk.id, ...rec() },
      {
        orgId,
        runId: run.id,
        itemId: cups.id,
        ...rec({
          onHand: 10,
          shortfall: 14.989,
          recommendedQty: 84.989,
          status: 'URGENT',
          notes: ['No supplier lead time: assumed 2 days.'],
        }),
      },
    ],
  });
  await prisma.forecast.createMany({
    data: [milk, cups].flatMap((item) =>
      Array.from({ length: 7 }, (_, i) => ({
        orgId,
        runId: run.id,
        itemId: item.id,
        forecastDate: day(`2025-03-${24 + i}`),
        predictedQty: 10 + i,
        lowerQty: 5,
        upperQty: 20 + i,
      })),
    ),
  });
  await prisma.demandHistory.createMany({
    data: [
      { orgId, itemId: milk.id, date: day('2025-03-23'), quantity: 12.5, source: 'IMPORT' },
      { orgId, itemId: milk.id, date: day('2025-02-24'), quantity: 9, source: 'IMPORT' },
      // before the 28-day window, and on the first forecast day: not sent
      { orgId, itemId: milk.id, date: day('2025-02-23'), quantity: 99, source: 'IMPORT' },
      { orgId, itemId: milk.id, date: day('2025-03-24'), quantity: 99, source: 'MOVEMENTS' },
    ],
  });
  return { run, milk, cups };
}

describe('GET /api/forecast/latest', () => {
  it('is for managers only', async () => {
    const res = await request(app).get('/api/forecast/latest').set(as(orgA, 'STAFF'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('says so when no forecast has run yet', async () => {
    const res = await request(app).get('/api/forecast/latest').set(as(orgA)).expect(200);
    expect(res.body).toEqual({ run: null, summary: null, items: [] });
  });

  it('returns the run, a summary, and each item — urgent first', async () => {
    const { run } = await seedRun(orgA);
    const res = await request(app).get('/api/forecast/latest').set(as(orgA)).expect(200);

    expect(res.body.run).toMatchObject({
      id: run.id,
      modelTag: 'lgbm-v1',
      modelKind: 'ML',
      isFallback: false,
      baselineTag: 'baseline-ma14',
      forecastFrom: '2025-03-24',
      horizonDays: 7,
      reviewDays: 7,
      evalWeeks: 8,
      serviceLevelZ: 1.65,
      maseModel: 1.0878,
      maseBaseline: 1.1261,
      mapeModel: 0.456,
      mapeBaseline: 0.5034,
    });
    expect(res.body.summary).toEqual({ items: 2, urgent: 1, reorder: 0, ok: 1 });
    expect(res.body.items.map((i: { item: { name: string } }) => i.item.name)).toEqual([
      'Paper cup',
      'Fresh milk',
    ]);

    const cups = res.body.items[0];
    expect(cups.recommendation).toEqual({
      ...rec({ onHand: 10, shortfall: 14.989, recommendedQty: 84.989, status: 'URGENT' }),
      spoilageCapApplied: false,
      notes: ['No supplier lead time: assumed 2 days.'],
    });
    expect(cups.forecast).toHaveLength(7);
    expect(cups.forecast[0]).toEqual({ date: '2025-03-24', predicted: 10, lower: 5, upper: 20 });
  });

  it('sends the 28 days of actual demand before the forecast, with missing days as 0', async () => {
    await seedRun(orgA);
    const res = await request(app).get('/api/forecast/latest').set(as(orgA)).expect(200);
    const milk = res.body.items.find(
      (i: { item: { name: string } }) => i.item.name === 'Fresh milk',
    );
    expect(milk.history).toHaveLength(28);
    expect(milk.history[0]).toEqual({ date: '2025-02-24', quantity: 9 });
    expect(milk.history[27]).toEqual({ date: '2025-03-23', quantity: 12.5 });
    expect(milk.history.slice(1, 27).every((d: { quantity: number }) => d.quantity === 0)).toBe(
      true,
    );
  });

  it('shows only the latest successful run, and only this café’s', async () => {
    await seedRun(orgA, { startedAt: new Date('2026-09-25T01:00:00Z') });
    await prisma.forecastRun.create({
      data: {
        orgId: orgA,
        modelTag: 'broken',
        modelKind: 'ML',
        status: 'FAILED',
        errorMessage: 'x',
      },
    });
    const newer = await prisma.forecastRun.create({
      data: {
        orgId: orgA,
        modelTag: 'baseline-ma14',
        modelKind: 'BASELINE',
        status: 'SUCCEEDED',
        forecastFrom: day('2025-03-31'),
        startedAt: new Date('2026-09-26T01:00:00Z'),
      },
    });
    const res = await request(app).get('/api/forecast/latest').set(as(orgA)).expect(200);
    expect(res.body.run.id).toBe(newer.id);
    expect(res.body.items).toEqual([]); // the newer run has no rows of its own

    const other = await request(app).get('/api/forecast/latest').set(as(orgB)).expect(200);
    expect(other.body.run).toBeNull();
  });
});

describe('GET /api/forecast/latest-run', () => {
  it('returns just the run, with the headline MASE and the forecast date', async () => {
    await seedRun(orgA);
    const res = await request(app).get('/api/forecast/latest-run').set(as(orgA)).expect(200);
    expect(res.body.run).toMatchObject({
      modelTag: 'lgbm-v1',
      maseModel: 1.0878,
      forecastFrom: '2025-03-24',
    });
    await request(app).get('/api/forecast/latest-run').set(as(orgA, 'STAFF')).expect(403);
  });
});
