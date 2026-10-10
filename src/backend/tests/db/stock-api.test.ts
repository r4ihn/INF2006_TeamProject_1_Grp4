import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { dateInTimeZone } from '../../src/lib/dates.js';
import { testAuthenticator } from './test-auth.js';
import { createTestPrisma, makeOrg, resetData } from './test-db.js';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());

const app = createApp({
  config: loadConfig({}),
  prisma,
  authenticate: testAuthenticator,
});

let orgA: string;
let orgB: string;
let milk: string; // org A, unit L, reorder point 10
let beans: string; // org A, unit kg
const asA = () => ({ 'x-test-org': orgA });
const asB = () => ({ 'x-test-org': orgB });
const todaySG = () => dateInTimeZone(new Date(), 'Asia/Singapore');

beforeEach(async () => {
  await resetData(prisma);
  orgA = (await makeOrg(prisma, 'Cafe A')).id;
  orgB = (await makeOrg(prisma, 'Cafe B')).id;
  milk = (
    await prisma.item.create({
      data: { orgId: orgA, name: 'Whole milk', category: 'Dairy', unit: 'L', reorderPoint: 10 },
    })
  ).id;
  beans = (
    await prisma.item.create({
      data: { orgId: orgA, name: 'Espresso beans', category: 'Coffee', unit: 'kg' },
    })
  ).id;
});

const move = (body: object, as = asA()) =>
  request(app).post('/api/stock/movements').set(as).send(body);
const count = (body: object, as = asA()) =>
  request(app).post('/api/stock/counts').set(as).send(body);
const onHand = async (id: string) =>
  Number((await prisma.item.findUniqueOrThrow({ where: { id } })).onHand);
const demandRows = (itemId: string) =>
  prisma.demandHistory.findMany({ where: { itemId }, orderBy: { date: 'asc' } });

describe('recording movements', () => {
  it('a delivery adds stock and logs a movement, but is not demand', async () => {
    const res = await move({ itemId: milk, type: 'RECEIVE', quantity: 20, note: 'Morning drop' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'RECEIVE',
      before: 0,
      change: 20,
      after: 20,
      demandRecorded: 0,
      demandDate: null,
      item: { id: milk, name: 'Whole milk', unit: 'L', onHand: 20, isLow: false },
    });
    expect(await onHand(milk)).toBe(20);

    const [m] = await prisma.inventoryMovement.findMany({ where: { itemId: milk } });
    expect(m).toMatchObject({ type: 'RECEIVE', note: 'Morning drop' });
    expect(Number(m!.quantityChange)).toBe(20);
    expect(Number(m!.quantityAfter)).toBe(20);
    expect(await demandRows(milk)).toHaveLength(0);
  });

  it('usage takes stock away and is recorded as demand for today (Singapore time)', async () => {
    await move({ itemId: milk, type: 'RECEIVE', quantity: 20 });
    const res = await move({ itemId: milk, type: 'USAGE', quantity: 7.5 });

    expect(res.body).toMatchObject({ change: -7.5, after: 12.5, demandRecorded: 7.5 });
    expect(res.body.demandDate).toBe(todaySG());
    const rows = await demandRows(milk);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.quantity)).toBe(7.5);
    expect(rows[0]!.source).toBe('MOVEMENTS');
  });

  it('usage on the same day adds up; other days get their own row', async () => {
    await move({ itemId: milk, type: 'RECEIVE', quantity: 50 });
    await move({ itemId: milk, type: 'USAGE', quantity: 3 });
    await move({ itemId: milk, type: 'USAGE', quantity: 4.25 });
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    await move({ itemId: milk, type: 'USAGE', quantity: 6, occurredAt: yesterday });

    const rows = await demandRows(milk);
    expect(rows.map((r) => Number(r.quantity))).toEqual([6, 7.25]);
    expect(await onHand(milk)).toBe(36.75);
  });

  it('books demand on the café’s calendar day, not UTC', async () => {
    await move({ itemId: milk, type: 'RECEIVE', quantity: 10 });
    // 01:30 in Singapore on the 25th is still the 24th in UTC
    const lateNight = new Date(Date.now() - 2 * 86_400_000);
    lateNight.setUTCHours(17, 30, 0, 0); // 17:30 UTC = 01:30 next day in SG
    const res = await move({
      itemId: milk,
      type: 'USAGE',
      quantity: 1,
      occurredAt: lateNight.toISOString(),
    });
    const sgDate = dateInTimeZone(lateNight, 'Asia/Singapore');
    expect(sgDate).not.toBe(lateNight.toISOString().slice(0, 10));
    expect(res.body.demandDate).toBe(sgDate);
  });

  it('waste and adjustments change stock but are not demand', async () => {
    await move({ itemId: milk, type: 'RECEIVE', quantity: 10 });
    expect((await move({ itemId: milk, type: 'WASTE', quantity: 2 })).body.after).toBe(8);
    expect((await move({ itemId: milk, type: 'ADJUSTMENT', quantity: -1.5 })).body.after).toBe(6.5);
    expect((await move({ itemId: milk, type: 'ADJUSTMENT', quantity: 0.5 })).body.after).toBe(7);
    expect(await demandRows(milk)).toHaveLength(0);
  });

  it('never lets stock go below zero — and saves nothing when refused', async () => {
    await move({ itemId: beans, type: 'RECEIVE', quantity: 2.5 });
    const res = await move({ itemId: beans, type: 'USAGE', quantity: 3 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.fields.quantity).toBe('Only 2.5 kg on hand');
    expect(await onHand(beans)).toBe(2.5);
    expect(await prisma.inventoryMovement.count({ where: { itemId: beans } })).toBe(1);
    expect(await demandRows(beans)).toHaveLength(0);
  });

  it('updates the low-stock flag', async () => {
    const res = await move({ itemId: milk, type: 'RECEIVE', quantity: 9 });
    expect(res.body.item.isLow).toBe(true); // 9 ≤ reorder point 10
    const more = await move({ itemId: milk, type: 'RECEIVE', quantity: 5 });
    expect(more.body.item.isLow).toBe(false);
  });

  it('refuses archived items', async () => {
    await prisma.item.update({ where: { id: beans }, data: { isActive: false } });
    const res = await move({ itemId: beans, type: 'RECEIVE', quantity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ITEM_ARCHIVED');
  });

  it('keeps stock correct when many people record at the same moment', async () => {
    await move({ itemId: milk, type: 'RECEIVE', quantity: 10 });

    // 12 simultaneous "used 1 L" requests against 10 L: exactly 10 succeed, 2 are refused.
    const results = await Promise.all(
      Array.from({ length: 12 }, () => move({ itemId: milk, type: 'USAGE', quantity: 1 })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 409)).toHaveLength(2);
    expect(await onHand(milk)).toBe(0);

    const afters = results
      .filter((r) => r.status === 201)
      .map((r) => r.body.after as number)
      .sort((a, b) => a - b);
    expect(afters).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // no lost updates
    expect(Number((await demandRows(milk))[0]!.quantity)).toBe(10);
  });
});

describe('validation', () => {
  it.each([
    [{ type: 'RECEIVE', quantity: 1 }, 'itemId', 'Choose an item'],
    [{ type: 'RECEIVE', quantity: 0 }, 'quantity', 'Quantity must be more than 0'],
    [{ type: 'USAGE', quantity: -2 }, 'quantity', 'Quantity must be more than 0'],
    [{ type: 'ADJUSTMENT', quantity: 0 }, 'quantity', 'An adjustment can’t be zero'],
    [
      { type: 'RECEIVE', quantity: 1.0005 },
      'quantity',
      'Quantity can have at most 3 decimal places',
    ],
    [{ type: 'COUNT', quantity: 1 }, 'type', 'Choose delivery, usage, waste or adjustment'],
    [
      { type: 'RECEIVE', quantity: 1, occurredAt: '2099-01-01T00:00:00Z' },
      'occurredAt',
      'Can’t be in the future',
    ],
    [
      { type: 'RECEIVE', quantity: 1, occurredAt: '2020-01-01T00:00:00Z' },
      'occurredAt',
      'Can’t be more than 90 days ago',
    ],
  ])('rejects %j (%s)', async (body, field, message) => {
    const res = await move(field === 'itemId' ? body : { itemId: milk, ...body });
    expect(res.status).toBe(400);
    expect(res.body.error.fields[field]).toBe(message);
  });

  it('rejects an item from another organisation', async () => {
    const theirs = await prisma.item.create({
      data: { orgId: orgB, name: 'Their milk', category: 'Dairy', unit: 'L' },
    });
    const res = await move({ itemId: theirs.id, type: 'RECEIVE', quantity: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.itemId).toBe('Choose one of your own items');
    expect(await onHand(theirs.id)).toBe(0);
  });

  it('does not let the client set on-hand directly or pick the organisation', async () => {
    const res = await move({ itemId: milk, type: 'RECEIVE', quantity: 1, after: 99, orgId: orgB });
    expect(res.status).toBe(400);
  });
});

describe('stock counts (stocktake)', () => {
  it('sets on-hand to what was counted; a shortfall is recorded as demand', async () => {
    await move({ itemId: milk, type: 'RECEIVE', quantity: 20 });
    await move({ itemId: beans, type: 'RECEIVE', quantity: 3 });

    const res = await count({
      counts: [
        { itemId: milk, counted: 14.5 }, // 5.5 L unaccounted for → used
        { itemId: beans, counted: 3.2 }, // 0.2 kg more than expected → not demand
      ],
      note: 'Closing count',
    });

    expect(res.status).toBe(201);
    expect(res.body.counted).toBe(2);
    expect(res.body.changes[0]).toMatchObject({
      itemId: milk,
      type: 'COUNT',
      before: 20,
      change: -5.5,
      after: 14.5,
      demandRecorded: 5.5,
      item: { onHand: 14.5 },
    });
    expect(res.body.changes[1]).toMatchObject({
      itemId: beans,
      before: 3,
      change: 0.2,
      after: 3.2,
      demandRecorded: 0,
    });

    expect(await onHand(milk)).toBe(14.5);
    expect(await onHand(beans)).toBe(3.2);
    expect(Number((await demandRows(milk))[0]!.quantity)).toBe(5.5);
    expect(await demandRows(beans)).toHaveLength(0);
    const movements = await prisma.inventoryMovement.findMany({ where: { type: 'COUNT' } });
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.note === 'Closing count')).toBe(true);
  });

  it('records a count that matches as a zero-change movement (proof it was checked)', async () => {
    await move({ itemId: milk, type: 'RECEIVE', quantity: 5 });
    const res = await count({ counts: [{ itemId: milk, counted: 5 }] });
    expect(res.body.changes[0]).toMatchObject({ change: 0, after: 5, demandRecorded: 0 });
  });

  it('is all-or-nothing: one bad item means nothing is saved', async () => {
    await move({ itemId: milk, type: 'RECEIVE', quantity: 20 });
    await prisma.item.update({ where: { id: beans }, data: { isActive: false } });

    const res = await count({
      counts: [
        { itemId: milk, counted: 10 },
        { itemId: beans, counted: 1 }, // archived → refused
      ],
    });
    expect(res.status).toBe(409);
    expect(await onHand(milk)).toBe(20); // unchanged
    expect(await prisma.inventoryMovement.count({ where: { type: 'COUNT' } })).toBe(0);
    expect(await demandRows(milk)).toHaveLength(0);
  });

  it.each([
    [{ counts: [] }, 'counts', 'Count at least one item'],
    [{ counts: [{ itemId: 'MILK', counted: 1 }] }, 'counts.0.itemId', 'Choose an item'],
    [
      { counts: [{ itemId: '00000000-0000-4000-8000-000000000001', counted: -1 }] },
      'counts.0.counted',
      'Counted quantity cannot be negative',
    ],
  ])('rejects %j', async (body, field, message) => {
    const res = await count(body);
    expect(res.status).toBe(400);
    expect(res.body.error.fields[field]).toBe(message);
  });

  it('rejects counting the same item twice in one stocktake', async () => {
    const res = await count({
      counts: [
        { itemId: milk, counted: 1 },
        { itemId: milk, counted: 2 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.counts).toBe('Each item can only be counted once per stocktake');
  });
});

describe('history', () => {
  it('lists movements newest first, filtered by item and type', async () => {
    await move({ itemId: milk, type: 'RECEIVE', quantity: 20 });
    await move({ itemId: beans, type: 'RECEIVE', quantity: 5 });
    await move({ itemId: milk, type: 'USAGE', quantity: 2 });
    await count({ counts: [{ itemId: milk, counted: 17 }] });

    const all = await request(app).get('/api/stock/movements').set(asA());
    expect(all.body).toHaveLength(4);
    expect(all.body[0]).toMatchObject({
      type: 'COUNT',
      quantityChange: -1,
      quantityAfter: 17,
      item: { id: milk, name: 'Whole milk', unit: 'L' },
    });

    const milkOnly = await request(app).get(`/api/stock/movements?itemId=${milk}`).set(asA());
    expect(milkOnly.body.map((m: { type: string }) => m.type)).toEqual([
      'COUNT',
      'USAGE',
      'RECEIVE',
    ]);

    const usage = await request(app).get('/api/stock/movements?type=USAGE').set(asA());
    expect(usage.body).toHaveLength(1);

    const limited = await request(app).get('/api/stock/movements?limit=2').set(asA());
    expect(limited.body).toHaveLength(2);
  });

  it('returns a daily demand series with zeros for quiet days', async () => {
    await move({ itemId: milk, type: 'RECEIVE', quantity: 100 });
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    await move({ itemId: milk, type: 'USAGE', quantity: 4, occurredAt: daysAgo(2) });
    await move({ itemId: milk, type: 'USAGE', quantity: 6 });
    await count({ counts: [{ itemId: milk, counted: 88 }] }); // 2 L shortfall today

    const res = await request(app).get(`/api/stock/demand?itemId=${milk}&days=7`).set(asA());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ unit: 'L', to: todaySG(), total: 12 });
    expect(res.body.days).toHaveLength(7);
    expect(res.body.days.at(-1)).toEqual({ date: todaySG(), quantity: 8 });
    expect(res.body.days.at(-3).quantity).toBe(4);
    expect(res.body.days.filter((d: { quantity: number }) => d.quantity === 0)).toHaveLength(5);
    expect(res.body.averagePerDay).toBeCloseTo(12 / 7, 3);
  });
});

describe('organisation scoping', () => {
  it('never shows another organisation’s movements or demand', async () => {
    await move({ itemId: milk, type: 'RECEIVE', quantity: 10 });
    await move({ itemId: milk, type: 'USAGE', quantity: 1 });

    expect((await request(app).get('/api/stock/movements').set(asB())).body).toEqual([]);
    const demand = await request(app).get(`/api/stock/demand?itemId=${milk}`).set(asB());
    expect(demand.status).toBe(404);
  });
});
