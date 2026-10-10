import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { main } from '../../src/cli/import-dataset.js';
import { loadConfig } from '../../src/config.js';
import { loadDataset, readDataset, type Dataset } from '../../src/import/coffee-dataset.js';
import { importDataset } from '../../src/import/import-dataset.js';
import { isoDate } from '../../src/lib/dates.js';
import { miniDataset } from '../fixtures/mini-dataset.js';
import { testAuthenticator } from './test-auth.js';
import { createTestPrisma, makeOrg, resetData } from './test-db.js';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());
const app = createApp({ config: loadConfig({}), prisma, authenticate: testAuthenticator });

const DATA_DIR = fileURLToPath(new URL('../../../../data/', import.meta.url));

let orgA: string;
let orgB: string;
beforeEach(async () => {
  await resetData(prisma);
  orgA = (await makeOrg(prisma, 'Cafe A')).id;
  orgB = (await makeOrg(prisma, 'Cafe B')).id;
});

const mini = (overrides?: Parameters<typeof miniDataset>[0]) => readDataset(miniDataset(overrides));
const run = (dataset: Dataset, extra: Partial<Parameters<typeof importDataset>[1]> = {}) =>
  importDataset(prisma, { orgId: orgA, dataset, source: 'Test dataset', ...extra });

const itemByName = (orgId: string, name: string) =>
  prisma.item.findFirstOrThrow({ where: { orgId, name } });
const series = async (itemId: string) =>
  (await prisma.demandHistory.findMany({ where: { itemId }, orderBy: { date: 'asc' } })).map(
    (d) => [isoDate(d.date), Number(d.quantity), d.source] as const,
  );

describe('importing the team dataset (data/)', () => {
  it(
    'loads 8 items, 388 days of demand each, and the full ledger',
    { timeout: 60_000 },
    async () => {
      const dataset = await loadDataset(DATA_DIR);
      const result = await run(dataset);

      expect(result).toMatchObject({
        dateFrom: '2024-03-01',
        dateTo: '2025-03-23',
        dayCount: 388,
        items: { created: 8, matched: 0 },
        suppliersCreated: 2,
        demand: { inserted: 3104, updated: 0, unchanged: 0, skipped: 0 },
        movementsInserted: 17049,
        ledgerSkipped: [],
      });

      // Every item has one row per day, oldest to newest, with the zero days present
      const perItem = await prisma.demandHistory.groupBy({
        by: ['itemId'],
        where: { orgId: orgA },
        _count: { _all: true },
        _min: { date: true },
        _max: { date: true },
      });
      expect(perItem).toHaveLength(8);
      for (const p of perItem) {
        expect(p._count._all).toBe(388);
        expect(isoDate(p._min.date!)).toBe('2024-03-01');
        expect(isoDate(p._max.date!)).toBe('2025-03-23');
      }

      // Spot-check against daily_demand.csv: milk on the first three days
      const milk = await itemByName(orgA, 'Fresh milk');
      expect((await series(milk.id)).slice(0, 3)).toEqual([
        ['2024-03-01', 1460, 'IMPORT'],
        ['2024-03-02', 180, 'IMPORT'],
        ['2024-03-03', 1040, 'IMPORT'],
      ]);

      // Stock on hand is the ledger's closing balance (matches restocking_recommendations.csv)
      const onHand = Object.fromEntries(
        (await prisma.item.findMany({ where: { orgId: orgA } })).map((i) => [
          i.name,
          Number(i.onHand),
        ]),
      );
      expect(onHand).toEqual({
        'Espresso beans': 1559,
        'Fresh milk': 5700,
        'Drinking chocolate': 224,
        'Cocoa powder': 257,
        'Paper cup 8oz': 7,
        'Paper cup 12oz': 66,
        'Cup lid 12oz': 117,
        Napkin: 65,
      });

      const record = await prisma.datasetImport.findFirstOrThrow({ where: { orgId: orgA } });
      expect(record).toMatchObject({ itemCount: 8, dayCount: 388, movementsInserted: 17049 });
      expect(
        (record.files as { file: string; rows: number }[]).map((f) => [f.file, f.rows]),
      ).toEqual([
        ['ingredients.csv', 8],
        ['daily_demand.csv', 3104],
        ['stock_movements.csv', 17049],
      ]);
    },
  );
});

describe('importDataset', () => {
  it('creates items with the dataset’s values and a supplier per lead time', async () => {
    await run(mini());
    const milk = await itemByName(orgA, 'Fresh milk');
    expect({
      sku: milk.sku,
      category: milk.category,
      unit: milk.unit,
      unitCost: Number(milk.unitCost),
      reorderPoint: Number(milk.reorderPoint),
      onHand: Number(milk.onHand),
    }).toEqual({
      sku: 'ING-001',
      category: 'Chiller',
      unit: 'ml',
      unitCost: 0.0021,
      reorderPoint: 3120,
      onHand: 1060, // 1000 − 220 − 220 − 300 + 1000 − 200
    });
    const suppliers = await prisma.supplier.findMany({
      where: { orgId: orgA },
      orderBy: { leadTimeDays: 'asc' },
      include: { items: { select: { name: true } } },
    });
    expect(suppliers.map((s) => [s.name, s.leadTimeDays, s.items.map((i) => i.name)])).toEqual([
      ['Chilled goods supplier', 1, ['Fresh milk']],
      ['Dry goods supplier', 3, ['Paper cup 12oz']],
    ]);
  });

  it('writes the ledger with running totals and marks it as imported', async () => {
    const { importId } = await run(mini());
    const cups = await itemByName(orgA, 'Paper cup 12oz');
    const rows = await prisma.inventoryMovement.findMany({
      where: { itemId: cups.id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(rows.map((r) => [r.type, Number(r.quantityChange), Number(r.quantityAfter)])).toEqual([
      ['RECEIVE', 50, 50],
      ['USAGE', -1, 49],
      ['USAGE', -1, 48],
      ['ADJUSTMENT', -3, 45],
      ['USAGE', -1, 44],
      ['USAGE', -1, 43],
    ]);
    expect(rows.every((r) => r.importId === importId && r.createdById === null)).toBe(true);
    // Café-local times: 10:15:50.520 in Singapore is 02:15:50.520 UTC
    expect(rows[1]!.occurredAt.toISOString()).toBe('2024-03-01T02:15:50.520Z');
    expect(Number(cups.onHand)).toBe(43);
  });

  it('is safe to run again: nothing is duplicated', async () => {
    await run(mini());
    const second = await run(mini());
    expect(second).toMatchObject({
      items: { created: 0, matched: 2 },
      suppliersCreated: 0,
      demand: { inserted: 0, updated: 0, unchanged: 6, skipped: 0 },
      movementsInserted: 0,
      ledgerSkipped: [
        { item: 'Fresh milk', reason: 'ledger already imported' },
        { item: 'Paper cup 12oz', reason: 'ledger already imported' },
      ],
    });
    expect(await prisma.item.count({ where: { orgId: orgA } })).toBe(2);
    expect(await prisma.demandHistory.count({ where: { orgId: orgA } })).toBe(6);
    expect(await prisma.inventoryMovement.count({ where: { orgId: orgA } })).toBe(12);
    // …and both runs are on record
    expect(await prisma.datasetImport.count({ where: { orgId: orgA } })).toBe(2);
  });

  it('updates a day whose value changed in a new version of the file', async () => {
    await run(mini(), {});
    const { ingredients, demand } = miniDataset({
      demand: [
        '2024-03-01,1,440,,,,,',
        '2024-03-01,2,2,,,,,',
        '2024-03-02,1,0,,,,,',
        '2024-03-02,2,1,,,,,',
        '2024-03-03,1,250,,,,,', // was 200
        '2024-03-03,2,1,,,,,',
      ],
    });
    const result = await run(readDataset({ ingredients, demand, ledger: null }));
    expect(result.demand).toEqual({ inserted: 0, updated: 1, unchanged: 5, skipped: 0 });
    const milk = await itemByName(orgA, 'Fresh milk');
    expect((await series(milk.id)).at(-1)).toEqual(['2024-03-03', 250, 'IMPORT']);
  });

  it('never overwrites a day the app recorded itself', async () => {
    await run(mini(), { dryRun: false });
    const milk = await itemByName(orgA, 'Fresh milk');
    await prisma.demandHistory.update({
      where: { orgId_itemId_date: { orgId: orgA, itemId: milk.id, date: new Date('2024-03-02') } },
      data: { source: 'MOVEMENTS', quantity: 7, importId: null },
    });
    const again = await run(mini());
    expect(again.demand).toEqual({ inserted: 0, updated: 0, unchanged: 5, skipped: 1 });
    expect((await series(milk.id))[1]).toEqual(['2024-03-02', 7, 'MOVEMENTS']);
  });

  it('only touches its own organisation', async () => {
    const other = await prisma.item.create({
      data: { orgId: orgB, name: 'Fresh milk', category: 'Dairy', unit: 'ml' },
    });
    await run(mini());
    expect(await prisma.item.count({ where: { orgId: orgB } })).toBe(1);
    expect(await prisma.demandHistory.count({ where: { orgId: orgB } })).toBe(0);
    expect(await prisma.inventoryMovement.count({ where: { orgId: orgB } })).toBe(0);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: other.id } })).category).toBe(
      'Dairy',
    );

    // Importing into B gives B its own copies
    await importDataset(prisma, { orgId: orgB, dataset: mini(), source: 'Test' });
    expect(await prisma.item.count({ where: { orgId: orgB } })).toBe(2); // matched "Fresh milk"
    expect(await prisma.demandHistory.count({ where: { orgId: orgB } })).toBe(6);
  });

  it('uses an existing item (by SKU, then name) without changing it', async () => {
    const mine = await prisma.item.create({
      data: { orgId: orgA, name: 'FRESH MILK', category: 'Dairy', unit: 'ML', unitCost: 2.5 },
    });
    const result = await run(mini());
    expect(result.items).toEqual({ created: 1, matched: 1 });
    const after = await prisma.item.findUniqueOrThrow({ where: { id: mine.id } });
    expect([after.name, after.category, after.unit, Number(after.unitCost)]).toEqual([
      'FRESH MILK',
      'Dairy',
      'ML',
      2.5,
    ]);
    expect(await prisma.demandHistory.count({ where: { itemId: mine.id } })).toBe(3);
  });

  it('refuses to match an existing item measured in a different unit', async () => {
    await prisma.item.create({
      data: { orgId: orgA, name: 'Fresh milk', category: 'Dairy', unit: 'L' },
    });
    await expect(run(mini())).rejects.toThrow(
      'Your item "Fresh milk" is measured in L, but the dataset measures Fresh milk in ml',
    );
    expect(await prisma.item.count({ where: { orgId: orgA } })).toBe(1);
    expect(await prisma.supplier.count({ where: { orgId: orgA } })).toBe(0);
    expect(await prisma.datasetImport.count()).toBe(0);
  });

  it('leaves the ledger alone for an item the café is already tracking in the app', async () => {
    const mine = await prisma.item.create({
      data: { orgId: orgA, name: 'Fresh milk', category: 'Dairy', unit: 'ml' },
    });
    await request(app)
      .post('/api/stock/movements')
      .set({ 'x-test-org': orgA })
      .send({ itemId: mine.id, type: 'RECEIVE', quantity: 500 })
      .expect(201);

    const result = await run(mini());
    expect(result.ledgerSkipped).toEqual([
      { item: 'Fresh milk', reason: 'has stock changes recorded in the app' },
    ]);
    expect(Number((await prisma.item.findUniqueOrThrow({ where: { id: mine.id } })).onHand)).toBe(
      500,
    );
    expect(await prisma.inventoryMovement.count({ where: { itemId: mine.id } })).toBe(1);
  });

  it('--replace removes earlier imported data first', async () => {
    await run(mini());
    const result = await run(mini(), { replace: true });
    expect(result.replaced).toEqual({ demandRows: 6, movements: 12 });
    expect(result.demand.inserted).toBe(6);
    expect(result.movementsInserted).toBe(12);
    expect(Number((await itemByName(orgA, 'Fresh milk')).onHand)).toBe(1060);
  });

  it('--replace refuses when the app recorded stock changes on top of the imported ledger', async () => {
    await run(mini());
    const milk = await itemByName(orgA, 'Fresh milk');
    await request(app)
      .post('/api/stock/movements')
      .set({ 'x-test-org': orgA })
      .send({ itemId: milk.id, type: 'USAGE', quantity: 60 })
      .expect(201);
    await expect(run(mini(), { replace: true })).rejects.toThrow(
      /Fresh milk has stock changes recorded in the app on top of the imported ledger/,
    );
    expect(await prisma.inventoryMovement.count({ where: { orgId: orgA } })).toBe(13);
  });

  it('can move dates forward in whole weeks, and records it', async () => {
    const result = await run(mini(), { shiftDays: 7 });
    expect([result.dateFrom, result.dateTo]).toEqual(['2024-03-08', '2024-03-10']);
    const milk = await itemByName(orgA, 'Fresh milk');
    expect((await series(milk.id)).map(([d]) => d)).toEqual([
      '2024-03-08',
      '2024-03-09',
      '2024-03-10',
    ]);
    const first = await prisma.inventoryMovement.findFirstOrThrow({
      where: { itemId: milk.id, type: 'USAGE' },
      orderBy: { occurredAt: 'asc' },
    });
    expect(first.occurredAt.toISOString()).toBe('2024-03-08T02:15:50.520Z');
    expect(
      (await prisma.datasetImport.findFirstOrThrow({ where: { orgId: orgA } })).dateShiftDays,
    ).toBe(7);

    // Re-running with different dates would duplicate the history on other days
    await expect(run(mini())).rejects.toThrow(/moved dates by 7 days.*--replace/);
  });

  it('a dry run saves nothing', async () => {
    const result = await run(mini(), { dryRun: true });
    expect(result).toMatchObject({ importId: null, dryRun: true, movementsInserted: 12 });
    expect(await prisma.item.count()).toBe(0);
    expect(await prisma.supplier.count()).toBe(0);
    expect(await prisma.demandHistory.count()).toBe(0);
    expect(await prisma.datasetImport.count()).toBe(0);
  });

  it('refuses a blank source', async () => {
    await expect(run(mini(), { source: '  ' })).rejects.toThrow(/Say where the data came from/);
  });
});

describe('npm run db:import (the command)', () => {
  const capture = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { log: (l: string) => out.push(l), error: (l: string) => err.push(l) } };
  };

  it('imports and prints the provenance and a per-item summary', { timeout: 60_000 }, async () => {
    const slug = (await prisma.organization.findUniqueOrThrow({ where: { id: orgA } })).slug;
    const { out, io } = capture();
    const code = await main(['--org', slug, '--dir', DATA_DIR, '--no-ledger'], { prisma, io });
    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toMatch(/daily_demand\.csv\s+3,104 rows\s+sha256 [0-9a-f]{12}…/);
    expect(text).toContain('Dates     2024-03-01 → 2025-03-23 (388 days)');
    expect(text).toContain('Demand    3,104 new, 0 changed, 0 unchanged');
    expect(text).toMatch(/Fresh milk\s+388\s+2024-03-01\s+2025-03-23\s+1,039\.74 ml\s+0 ml/);
  });

  it(
    '--if-empty imports once, then does nothing (a new server on AWS)',
    { timeout: 60_000 },
    async () => {
      const slug = (await prisma.organization.findUniqueOrThrow({ where: { id: orgA } })).slug;
      const args = [
        '--org',
        slug,
        '--dir',
        DATA_DIR,
        '--no-ledger',
        '--shift-to-recent',
        '--if-empty',
      ];
      const first = capture();
      expect(await main(args, { prisma, io: first.io })).toBe(0);
      expect(first.out.join('\n')).toContain('Demand    3,104 new');

      const again = capture();
      expect(await main(args, { prisma, io: again.io })).toBe(0);
      expect(again.out.join('\n')).toContain(
        'already has 1 dataset import — nothing to do (--if-empty)',
      );
      expect(await prisma.datasetImport.count({ where: { orgId: orgA } })).toBe(1);
      expect(await prisma.demandHistory.count({ where: { orgId: orgA } })).toBe(3104);
    },
  );

  it('explains problems without saving anything', async () => {
    const missingOrg = capture();
    expect(await main(['--org', 'no-such-cafe'], { prisma, io: missingOrg.io })).toBe(1);
    expect(missingOrg.err.join('\n')).toMatch(/no organisation "no-such-cafe".*db:setup/);

    const slug = (await prisma.organization.findUniqueOrThrow({ where: { id: orgA } })).slug;
    const badDir = capture();
    const dir = path.join(DATA_DIR, 'raw');
    expect(await main(['--org', slug, '--dir', dir], { prisma, io: badDir.io })).toBe(1);
    expect(badDir.err.join('\n')).toMatch(/Can’t find ingredients\.csv.*Nothing was saved/s);

    const badFlag = capture();
    expect(await main(['--nope'], { prisma, io: badFlag.io })).toBe(2);
    expect(badFlag.err.join('\n')).toContain('Usage: npm run db:import');
    expect(await prisma.item.count()).toBe(0);
  });
});

describe('history API', () => {
  const get = (url: string, as: Record<string, string> = { 'x-test-org': orgA }) =>
    request(app).get(url).set(as);

  it('GET /api/stock/history summarises each item’s demand history', async () => {
    await run(mini());
    const res = await get('/api/stock/history').expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        name: 'Fresh milk',
        unit: 'ml',
        category: 'Chiller',
        onHand: 1060,
        days: 3,
        importedDays: 3,
        recordedDays: 0,
        zeroDays: 1,
        firstDate: '2024-03-01',
        lastDate: '2024-03-03',
        total: 640,
        averagePerDay: 213.333,
      }),
      expect.objectContaining({ name: 'Paper cup 12oz', unit: 'pcs', total: 4, zeroDays: 0 }),
    ]);
    // Other organisations see none of it
    expect((await get('/api/stock/history', { 'x-test-org': orgB }).expect(200)).body).toEqual([]);
  });

  it('GET /api/stock/demand can end on a given date', async () => {
    await run(mini());
    const milk = await itemByName(orgA, 'Fresh milk');
    const res = await get(`/api/stock/demand?itemId=${milk.id}&days=4&to=2024-03-03`).expect(200);
    expect(res.body).toMatchObject({
      from: '2024-02-29',
      to: '2024-03-03',
      total: 640,
      averagePerDay: 160,
      days: [
        { date: '2024-02-29', quantity: 0 },
        { date: '2024-03-01', quantity: 440 },
        { date: '2024-03-02', quantity: 0 },
        { date: '2024-03-03', quantity: 200 },
      ],
    });
    await get(`/api/stock/demand?itemId=${milk.id}&to=2024-02-30`).expect(400);
    await get(`/api/stock/demand?itemId=${milk.id}&days=800`).expect(400);
  });

  it('GET /api/imports lists the provenance of each run, for this organisation only', async () => {
    await run(mini(), { source: 'Kaggle coffee sales (test)' });
    await run(mini());
    const res = await get('/api/imports').expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[1]).toMatchObject({
      source: 'Kaggle coffee sales (test)',
      dateFrom: '2024-03-01',
      dateTo: '2024-03-03',
      dayCount: 3,
      itemCount: 2,
      itemsCreated: 2,
      demandInserted: 6,
      movementsInserted: 12,
      dateShiftDays: 0,
      files: [
        expect.objectContaining({ file: 'ingredients.csv', rows: 2 }),
        expect.objectContaining({ file: 'daily_demand.csv', rows: 6 }),
        expect.objectContaining({ file: 'stock_movements.csv', rows: 12 }),
      ],
    });
    expect(res.body[1]).not.toHaveProperty('orgId');
    expect(res.body[0]).toMatchObject({ demandUnchanged: 6, ledgerItemsSkipped: 2 });
    expect((await get('/api/imports', { 'x-test-org': orgB }).expect(200)).body).toEqual([]);
  });

  it('imported ledger rows are marked in the activity list; staff can read history too', async () => {
    await run(mini());
    const staff = { 'x-test-org': orgA, 'x-test-role': 'STAFF' };
    const res = await get('/api/stock/movements?limit=2', staff).expect(200);
    expect(res.body[0]).toMatchObject({
      type: 'USAGE',
      note: 'Sale #4 — Hot Chocolate',
      imported: true,
      createdBy: null,
    });
    await get('/api/stock/history', staff).expect(200);
    await get('/api/imports', staff).expect(200);
  });
});
