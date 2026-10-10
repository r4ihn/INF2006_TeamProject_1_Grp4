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
const asA = () => ({ 'x-test-org': orgA });
const asB = () => ({ 'x-test-org': orgB });

beforeEach(async () => {
  await resetData(prisma);
  orgA = (await makeOrg(prisma, 'Cafe A')).id;
  orgB = (await makeOrg(prisma, 'Cafe B')).id;
});

const beanBros = {
  name: 'Bean Bros',
  contactName: 'Alex Tan',
  email: 'orders@beanbros.sg',
  phone: '+65 6123 4567',
  leadTimeDays: 3,
  notes: 'Delivers Tue & Fri',
};

describe('suppliers CRUD', () => {
  it('starts empty', async () => {
    const res = await request(app).get('/api/suppliers').set(asA());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('creates, reads, updates and deletes a supplier', async () => {
    // Create
    const created = await request(app).post('/api/suppliers').set(asA()).send(beanBros);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ ...beanBros, itemCount: 0 });
    expect(created.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.body).not.toHaveProperty('orgId');
    expect(created.headers.location).toBe(`/api/suppliers/${created.body.id}`);
    const id = created.body.id as string;

    // Read one + list
    const one = await request(app).get(`/api/suppliers/${id}`).set(asA());
    expect(one.status).toBe(200);
    expect(one.body.name).toBe('Bean Bros');

    const list = await request(app).get('/api/suppliers').set(asA());
    expect(list.body.map((s: { name: string }) => s.name)).toEqual(['Bean Bros']);

    // Update only what was sent
    const patched = await request(app)
      .patch(`/api/suppliers/${id}`)
      .set(asA())
      .send({ leadTimeDays: 5, phone: '' });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({
      name: 'Bean Bros',
      leadTimeDays: 5,
      phone: null, // "" clears an optional field
      email: 'orders@beanbros.sg',
    });

    // Delete
    const deleted = await request(app).delete(`/api/suppliers/${id}`).set(asA());
    expect(deleted.status).toBe(204);
    const gone = await request(app).get(`/api/suppliers/${id}`).set(asA());
    expect(gone.status).toBe(404);
  });

  it('only needs a name — lead time defaults to 2 days, optional fields to null', async () => {
    const res = await request(app).post('/api/suppliers').set(asA()).send({ name: '  FreshCo  ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'FreshCo', // trimmed
      leadTimeDays: 2,
      contactName: null,
      email: null,
      phone: null,
      notes: null,
    });
  });

  it('lists suppliers alphabetically, with item counts and search', async () => {
    for (const name of ['Dairy Direct', 'bakers united', 'Coffee Co']) {
      await request(app).post('/api/suppliers').set(asA()).send({ name });
    }
    const dairy = await prisma.supplier.findFirstOrThrow({ where: { name: 'Dairy Direct' } });
    await prisma.item.create({
      data: { orgId: orgA, supplierId: dairy.id, name: 'Milk', category: 'Dairy', unit: 'L' },
    });

    const all = await request(app).get('/api/suppliers').set(asA());
    expect(all.body.map((s: { name: string }) => s.name)).toEqual([
      'bakers united',
      'Coffee Co',
      'Dairy Direct',
    ]);
    expect(all.body.find((s: { name: string }) => s.name === 'Dairy Direct').itemCount).toBe(1);

    const search = await request(app).get('/api/suppliers?search=co').set(asA());
    expect(search.body.map((s: { name: string }) => s.name)).toEqual(['Coffee Co']);
  });
});

describe('validation', () => {
  it.each([
    [{}, 'name', 'Name is required'],
    [{ name: '   ' }, 'name', 'Name is required'],
    [{ name: 'X', leadTimeDays: -1 }, 'leadTimeDays', 'Lead time cannot be negative'],
    [{ name: 'X', leadTimeDays: 1.5 }, 'leadTimeDays', 'Lead time must be a whole number of days'],
    [{ name: 'X', leadTimeDays: '3' }, 'leadTimeDays', 'Lead time must be a number'],
    [{ name: 'X', email: 'not-an-email' }, 'email', 'Enter a valid email address'],
    [{ name: 'x'.repeat(121) }, 'name', 'Must be at most 120 characters'],
    [{ name: 'X', phone: 'call us' }, 'phone', 'Use digits only (spaces and a leading + are fine)'],
    [
      { name: 'X', phone: '6123-4567' },
      'phone',
      'Use digits only (spaces and a leading + are fine)',
    ],
    [{ name: 'X', phone: '+65 1234' }, 'phone', 'Enter 8 to 15 digits, e.g. +65 6123 4567'],
  ])('rejects %j (%s)', async (body, field, message) => {
    const res = await request(app).post('/api/suppliers').set(asA()).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields[field]).toBe(message);
  });

  it.each(['61234567', '6123 4567', '+65 6123 4567'])(
    'accepts the phone number %j',
    async (phone) => {
      const res = await request(app)
        .post('/api/suppliers')
        .set(asA())
        .send({ name: `S ${phone}`, phone });
      expect(res.status).toBe(201);
      expect(res.body.phone).toBe(phone);
    },
  );

  it('rejects fields the client is not allowed to set (e.g. orgId)', async () => {
    const res = await request(app)
      .post('/api/suppliers')
      .set(asA())
      .send({ name: 'Sneaky', orgId: orgB });
    expect(res.status).toBe(400);
    expect(await prisma.supplier.count()).toBe(0);
  });

  it('rejects an empty update', async () => {
    const { body } = await request(app).post('/api/suppliers').set(asA()).send({ name: 'X' });
    const res = await request(app).patch(`/api/suppliers/${body.id}`).set(asA()).send({});
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON with a 400', async () => {
    const res = await request(app)
      .post('/api/suppliers')
      .set(asA())
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 409 for a duplicate name (case-sensitive match) on create and rename', async () => {
    await request(app).post('/api/suppliers').set(asA()).send({ name: 'Bean Bros' });
    const dup = await request(app).post('/api/suppliers').set(asA()).send({ name: 'Bean Bros' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields.name).toBe('A supplier with this name already exists');

    const other = await request(app).post('/api/suppliers').set(asA()).send({ name: 'Other' });
    const rename = await request(app)
      .patch(`/api/suppliers/${other.body.id}`)
      .set(asA())
      .send({ name: 'Bean Bros' });
    expect(rename.status).toBe(409);
  });

  it('treats a malformed id as not found', async () => {
    const res = await request(app).get('/api/suppliers/not-a-uuid').set(asA());
    expect(res.status).toBe(404);
  });
});

describe('organisation scoping', () => {
  it('never shows, changes or deletes another organisation’s supplier', async () => {
    const theirs = await request(app).post('/api/suppliers').set(asB()).send(beanBros);
    const id = theirs.body.id as string;

    const list = await request(app).get('/api/suppliers').set(asA());
    expect(list.body).toEqual([]);

    expect((await request(app).get(`/api/suppliers/${id}`).set(asA())).status).toBe(404);
    expect(
      (await request(app).patch(`/api/suppliers/${id}`).set(asA()).send({ name: 'Hijacked' }))
        .status,
    ).toBe(404);
    expect((await request(app).delete(`/api/suppliers/${id}`).set(asA())).status).toBe(404);

    // Still there, unchanged, for its real owner
    const still = await request(app).get(`/api/suppliers/${id}`).set(asB());
    expect(still.status).toBe(200);
    expect(still.body.name).toBe('Bean Bros');
  });

  it('lets two organisations use the same supplier name', async () => {
    const a = await request(app).post('/api/suppliers').set(asA()).send({ name: 'FreshCo' });
    const b = await request(app).post('/api/suppliers').set(asB()).send({ name: 'FreshCo' });
    expect([a.status, b.status]).toEqual([201, 201]);
  });
});

describe('deleting a supplier that still has items', () => {
  it('is refused with a clear message', async () => {
    const { body } = await request(app).post('/api/suppliers').set(asA()).send({ name: 'Dairy' });
    await prisma.item.createMany({
      data: ['Milk', 'Cream'].map((name) => ({
        orgId: orgA,
        supplierId: body.id,
        name,
        category: 'Dairy',
        unit: 'L',
      })),
    });

    const res = await request(app).delete(`/api/suppliers/${body.id}`).set(asA());
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: 'IN_USE',
      message: 'This supplier still has 2 items. Move them to another supplier first.',
    });
  });
});

describe('without signing in', () => {
  it('the real app refuses /api requests with 401', async () => {
    const realApp = createApp({ config: loadConfig({}), prisma });
    const res = await request(realApp).get('/api/suppliers');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });
});
