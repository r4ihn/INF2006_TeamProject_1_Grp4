// Behavioural checks: the database itself rejects rows with a missing or invalid org_id,
// rows that point at another organisation's data, and obviously invalid values.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, makeOrg, pgErrorCode, resetData } from './test-db.js';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => resetData(prisma));

async function expectPgError(promise: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected Postgres error ${code}`).toBeDefined();
  expect(pgErrorCode(caught)).toBe(code);
}

describe('rows without a valid org_id are rejected', () => {
  it('missing org_id → NOT NULL violation (raw SQL, as the Lambda would write)', async () => {
    await expectPgError(
      prisma.$executeRaw`INSERT INTO suppliers (name) VALUES ('No Org Supplies')`,
      '23502',
    );
  });

  it('org_id that does not exist → foreign-key violation', async () => {
    const ghostOrg = crypto.randomUUID();
    await expectPgError(
      prisma.supplier.create({ data: { orgId: ghostOrg, name: 'Ghost Supplies' } }),
      '23503',
    );
    await expectPgError(
      prisma.$executeRaw`INSERT INTO items (org_id, name, category, unit)
                         VALUES (${ghostOrg}::uuid, 'Milk', 'Dairy', 'L')`,
      '23503',
    );
  });
});

describe('rows cannot point at another organisation’s data', () => {
  it('an item cannot use a supplier from a different org', async () => {
    const orgA = await makeOrg(prisma, 'Cafe A');
    const orgB = await makeOrg(prisma, 'Cafe B');
    const supplierOfB = await prisma.supplier.create({
      data: { orgId: orgB.id, name: 'B Beans' },
    });

    await expectPgError(
      prisma.item.create({
        data: {
          orgId: orgA.id,
          supplierId: supplierOfB.id,
          name: 'Espresso beans',
          category: 'Coffee',
          unit: 'kg',
        },
      }),
      '23503',
    );
  });

  it('a stock movement cannot reference another org’s item', async () => {
    const orgA = await makeOrg(prisma, 'Cafe A');
    const orgB = await makeOrg(prisma, 'Cafe B');
    const itemOfB = await prisma.item.create({
      data: { orgId: orgB.id, name: 'Oat milk', category: 'Dairy', unit: 'L' },
    });

    await expectPgError(
      prisma.inventoryMovement.create({
        data: {
          orgId: orgA.id,
          itemId: itemOfB.id,
          type: 'USAGE',
          quantityChange: -1,
          quantityAfter: 0,
        },
      }),
      '23503',
    );
  });

  it('a forecast cannot reference another org’s run', async () => {
    const orgA = await makeOrg(prisma, 'Cafe A');
    const orgB = await makeOrg(prisma, 'Cafe B');
    const itemOfA = await prisma.item.create({
      data: { orgId: orgA.id, name: 'Croissant', category: 'Bakery', unit: 'pcs' },
    });
    const runOfB = await prisma.forecastRun.create({
      data: { orgId: orgB.id, modelTag: 'lgbm-v3', modelKind: 'ML' },
    });

    await expectPgError(
      prisma.forecast.create({
        data: {
          orgId: orgA.id,
          runId: runOfB.id,
          itemId: itemOfA.id,
          forecastDate: new Date('2026-10-01'),
          predictedQty: 12,
        },
      }),
      '23503',
    );
  });

  it('the same supplier name is fine in two different orgs, but not twice in one', async () => {
    const orgA = await makeOrg(prisma, 'Cafe A');
    const orgB = await makeOrg(prisma, 'Cafe B');

    await prisma.supplier.create({ data: { orgId: orgA.id, name: 'FreshCo' } });
    await prisma.supplier.create({ data: { orgId: orgB.id, name: 'FreshCo' } });
    await expectPgError(
      prisma.supplier.create({ data: { orgId: orgA.id, name: 'FreshCo' } }),
      '23505',
    );
  });
});

describe('CHECK constraints reject impossible values', () => {
  it('negative supplier lead time', async () => {
    const org = await makeOrg(prisma);
    await expectPgError(
      prisma.supplier.create({ data: { orgId: org.id, name: 'Slow', leadTimeDays: -1 } }),
      '23514',
    );
  });

  it('negative unit cost, on-hand stock or spoilage cap on an item', async () => {
    const org = await makeOrg(prisma);
    const base = { orgId: org.id, category: 'Dairy', unit: 'L' };

    await expectPgError(
      prisma.item.create({ data: { ...base, name: 'A', unitCost: -1 } }),
      '23514',
    );
    await expectPgError(
      prisma.item.create({ data: { ...base, name: 'B', onHand: -0.5 } }),
      '23514',
    );
    await expectPgError(
      prisma.item.create({ data: { ...base, name: 'C', spoilageCap: -3 } }),
      '23514',
    );
  });

  it('negative demand or forecast quantities', async () => {
    const org = await makeOrg(prisma);
    const item = await prisma.item.create({
      data: { orgId: org.id, name: 'Milk', category: 'Dairy', unit: 'L' },
    });
    const run = await prisma.forecastRun.create({
      data: { orgId: org.id, modelTag: 'baseline-ma14', modelKind: 'BASELINE' },
    });

    await expectPgError(
      prisma.demandHistory.create({
        data: {
          orgId: org.id,
          itemId: item.id,
          date: new Date('2026-09-01'),
          quantity: -2,
          source: 'IMPORT',
        },
      }),
      '23514',
    );
    await expectPgError(
      prisma.forecast.create({
        data: {
          orgId: org.id,
          runId: run.id,
          itemId: item.id,
          forecastDate: new Date('2026-10-01'),
          predictedQty: -1,
        },
      }),
      '23514',
    );
  });

  it('a forecast horizon of zero days', async () => {
    const org = await makeOrg(prisma);
    await expectPgError(
      prisma.forecastRun.create({
        data: { orgId: org.id, modelTag: 'x', modelKind: 'ML', horizonDays: 0 },
      }),
      '23514',
    );
  });
});
