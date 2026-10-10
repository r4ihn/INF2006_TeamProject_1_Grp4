import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { testAuthenticator } from './test-auth.js';
import { createTestPrisma, makeOrg, resetData } from './test-db.js';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());

// Tests pick the acting organisation with a header (see test-auth.ts).
const app = createApp({
  config: loadConfig({}),
  prisma,
  authenticate: testAuthenticator,
});

let orgA: string;
let orgB: string;
let beanBros: string; // supplier in org A
let theirSupplier: string; // supplier in org B
const asA = () => ({ 'x-test-org': orgA });
const asB = () => ({ 'x-test-org': orgB });

beforeEach(async () => {
  await resetData(prisma);
  orgA = (await makeOrg(prisma, 'Cafe A')).id;
  orgB = (await makeOrg(prisma, 'Cafe B')).id;
  beanBros = (
    await prisma.supplier.create({ data: { orgId: orgA, name: 'Bean Bros', leadTimeDays: 3 } })
  ).id;
  theirSupplier = (await prisma.supplier.create({ data: { orgId: orgB, name: 'B Supplies' } })).id;
});

const beans = () => ({
  name: 'Espresso beans',
  sku: 'COF-001',
  category: 'Coffee',
  unit: 'kg',
  supplierId: beanBros,
  unitCost: 32.5,
  reorderPoint: 4,
  spoilageCap: 12.5,
});

describe('items CRUD', () => {
  it('creates, reads, updates and deletes an item', async () => {
    const created = await request(app).post('/api/items').set(asA()).send(beans());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Espresso beans',
      sku: 'COF-001',
      category: 'Coffee',
      unit: 'kg',
      unitCost: 32.5, // numbers, not "32.5" strings
      reorderPoint: 4,
      spoilageCap: 12.5,
      onHand: 0, // new items start empty; stock comes from Task 5
      isActive: true,
      isLow: true, // 0 on hand ≤ reorder point 4
      supplier: { id: beanBros, name: 'Bean Bros', leadTimeDays: 3 },
    });
    expect(created.body).not.toHaveProperty('orgId');
    const id = created.body.id as string;

    expect((await request(app).get(`/api/items/${id}`).set(asA())).body.name).toBe(
      'Espresso beans',
    );

    const patched = await request(app)
      .patch(`/api/items/${id}`)
      .set(asA())
      .send({ unitCost: 30, supplierId: null, sku: '' });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ unitCost: 30, supplier: null, sku: null, unit: 'kg' });

    expect((await request(app).delete(`/api/items/${id}`).set(asA())).status).toBe(204);
    expect((await request(app).get(`/api/items/${id}`).set(asA())).status).toBe(404);
  });

  it('needs only name, category and unit; costs default to 0, no supplier', async () => {
    const res = await request(app)
      .post('/api/items')
      .set(asA())
      .send({ name: ' Oat milk ', category: 'Dairy', unit: 'L' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Oat milk',
      unitCost: 0,
      reorderPoint: 0,
      spoilageCap: null,
      sku: null,
      supplier: null,
      isLow: false, // no reorder point set → never "low"
    });
  });

  it('lists active items grouped by category, then name, with filters', async () => {
    const add = (body: object) => request(app).post('/api/items').set(asA()).send(body);
    await add({ name: 'Whole milk', category: 'Dairy', unit: 'L' });
    await add({ name: 'croissant', category: 'Bakery', unit: 'pcs' });
    await add({ ...beans() });
    await add({ name: 'Almond milk', category: 'dairy', unit: 'L', sku: 'DAI-ALM' });
    const old = await add({ name: 'Old syrup', category: 'Syrups', unit: 'bottle' });
    await request(app).patch(`/api/items/${old.body.id}`).set(asA()).send({ isActive: false });

    const names = async (qs = '') =>
      (await request(app).get(`/api/items${qs}`).set(asA())).body.map(
        (i: { name: string }) => i.name,
      );

    expect(await names()).toEqual(['croissant', 'Espresso beans', 'Almond milk', 'Whole milk']);
    expect(await names('?category=DAIRY')).toEqual(['Almond milk', 'Whole milk']);
    expect(await names('?search=milk')).toEqual(['Almond milk', 'Whole milk']);
    expect(await names('?search=dai-alm')).toEqual(['Almond milk']); // matches SKU too
    expect(await names(`?supplierId=${beanBros}`)).toEqual(['Espresso beans']);
    expect(await names('?includeArchived=true')).toContain('Old syrup');

    const cats = await request(app).get('/api/items/categories').set(asA());
    // "dairy" was stored as the existing "Dairy", so the category isn't split in two
    expect(cats.body).toEqual(['Bakery', 'Coffee', 'Dairy', 'Syrups']);
  });

  it('archives and restores an item', async () => {
    const { body } = await request(app).post('/api/items').set(asA()).send(beans());
    const archived = await request(app)
      .patch(`/api/items/${body.id}`)
      .set(asA())
      .send({ isActive: false });
    expect(archived.body.isActive).toBe(false);
    expect((await request(app).get('/api/items').set(asA())).body).toEqual([]);

    await request(app).patch(`/api/items/${body.id}`).set(asA()).send({ isActive: true });
    expect((await request(app).get('/api/items').set(asA())).body).toHaveLength(1);
  });

  it('shows the item count on the supplier', async () => {
    await request(app).post('/api/items').set(asA()).send(beans());
    const supplier = await request(app).get(`/api/suppliers/${beanBros}`).set(asA());
    expect(supplier.body.itemCount).toBe(1);
  });
});

describe('validation', () => {
  const base = { name: 'X', category: 'C', unit: 'kg' };
  it.each([
    [{ category: 'C', unit: 'kg' }, 'name', 'Name is required'],
    [{ ...base, category: ' ' }, 'category', 'Category is required'],
    [{ ...base, unit: '' }, 'unit', 'Unit is required'],
    [{ ...base, unitCost: -1 }, 'unitCost', 'Unit cost cannot be negative'],
    [{ ...base, unitCost: 1.00005 }, 'unitCost', 'Unit cost can have at most 4 decimal places'],
    [{ ...base, unitCost: '3' }, 'unitCost', 'Unit cost must be a number'],
    [
      { ...base, reorderPoint: 0.0005 },
      'reorderPoint',
      'Reorder point can have at most 3 decimal places',
    ],
    [{ ...base, spoilageCap: -2 }, 'spoilageCap', 'Spoilage cap cannot be negative'],
    [{ ...base, supplierId: 'nope' }, 'supplierId', 'Choose an option from the list'],
  ])('rejects %j (%s)', async (body, field, message) => {
    const res = await request(app).post('/api/items').set(asA()).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.fields[field]).toBe(message);
  });

  it('accepts quantities with up to 3 decimals, e.g. 2.5 kg', async () => {
    const res = await request(app)
      .post('/api/items')
      .set(asA())
      .send({ ...base, reorderPoint: 2.125, unitCost: 0.35 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ reorderPoint: 2.125, unitCost: 0.35 });
  });

  it('does not let the client set stock on hand or the organisation', async () => {
    for (const extra of [{ onHand: 50 }, { orgId: orgB }]) {
      const res = await request(app)
        .post('/api/items')
        .set(asA())
        .send({ ...base, ...extra });
      expect(res.status).toBe(400);
    }
    expect(await prisma.item.count()).toBe(0);
  });

  it('409s on a duplicate name or SKU, with the right field highlighted', async () => {
    await request(app).post('/api/items').set(asA()).send(beans());

    const sameName = await request(app)
      .post('/api/items')
      .set(asA())
      .send({ ...beans(), sku: 'OTHER' });
    expect(sameName.status).toBe(409);
    expect(sameName.body.error.fields).toEqual({ name: 'An item with this name already exists' });

    const sameSku = await request(app)
      .post('/api/items')
      .set(asA())
      .send({ ...beans(), name: 'Decaf beans' });
    expect(sameSku.status).toBe(409);
    expect(sameSku.body.error.fields).toEqual({ sku: 'Another item already uses this SKU' });
  });

  it('allows many items without a SKU', async () => {
    for (const name of ['A', 'B']) {
      const res = await request(app)
        .post('/api/items')
        .set(asA())
        .send({ ...base, name });
      expect(res.status).toBe(201);
    }
  });
});

describe('item must reference a supplier in the same organisation', () => {
  it('rejects another organisation’s supplier on create and update', async () => {
    const create = await request(app)
      .post('/api/items')
      .set(asA())
      .send({ ...beans(), supplierId: theirSupplier });
    expect(create.status).toBe(400);
    expect(create.body.error.fields).toEqual({ supplierId: 'Choose one of your own suppliers' });

    const { body } = await request(app).post('/api/items').set(asA()).send(beans());
    const update = await request(app)
      .patch(`/api/items/${body.id}`)
      .set(asA())
      .send({ supplierId: theirSupplier });
    expect(update.status).toBe(400);
    expect(update.body.error.fields.supplierId).toBe('Choose one of your own suppliers');
  });

  it('rejects a supplier id that does not exist', async () => {
    const res = await request(app)
      .post('/api/items')
      .set(asA())
      .send({ ...beans(), supplierId: crypto.randomUUID() });
    expect(res.status).toBe(400);
  });
});

describe('organisation scoping', () => {
  it('never shows, changes or deletes another organisation’s item', async () => {
    const theirs = await request(app)
      .post('/api/items')
      .set(asB())
      .send({ name: 'Their milk', category: 'Dairy', unit: 'L', supplierId: theirSupplier });
    const id = theirs.body.id as string;

    expect((await request(app).get('/api/items').set(asA())).body).toEqual([]);
    expect((await request(app).get('/api/items/categories').set(asA())).body).toEqual([]);
    expect((await request(app).get(`/api/items/${id}`).set(asA())).status).toBe(404);
    expect(
      (await request(app).patch(`/api/items/${id}`).set(asA()).send({ name: 'Mine now' })).status,
    ).toBe(404);
    expect((await request(app).delete(`/api/items/${id}`).set(asA())).status).toBe(404);

    const still = await request(app).get(`/api/items/${id}`).set(asB());
    expect(still.body.name).toBe('Their milk');
  });
});

describe('deleting an item with history', () => {
  it('is refused and suggests archiving', async () => {
    const { body } = await request(app).post('/api/items').set(asA()).send(beans());
    await prisma.inventoryMovement.create({
      data: { orgId: orgA, itemId: body.id, type: 'RECEIVE', quantityChange: 5, quantityAfter: 5 },
    });

    const res = await request(app).delete(`/api/items/${body.id}`).set(asA());
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Archive it instead/);
  });
});
