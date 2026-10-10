// Sign-in and authorisation, end to end, with real signed tokens and a real database.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { DEV_USERS, type UserProfile } from '../../src/auth/profile.js';
import { createVerifier, LocalTokenIssuer } from '../../src/auth/tokens.js';
import { seedDemoOrg } from '../../src/db/seed.js';
import { createTestPrisma, makeOrg, resetData } from './test-db.js';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());

let demoOrgId: string;
beforeEach(async () => {
  await resetData(prisma);
  demoOrgId = (await seedDemoOrg(prisma)).id;
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// ─── Development mode (the default when Cognito isn't configured) ─────────────
describe('development sign-in', () => {
  const app = createApp({ config: loadConfig({}), prisma });
  const login = async (role: 'staff' | 'manager') => {
    const res = await request(app).post('/auth/dev/login').send({ role });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };

  it('tells the web app it is in development mode', async () => {
    const res = await request(app).get('/auth/config');
    expect(res.body).toMatchObject({ mode: 'dev', clientId: 'cafestock-dev-client' });
  });

  it('signs in as manager: /api/me shows the user, role and café', async () => {
    const token = await login('manager');
    const res = await request(app).get('/api/me').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: { email: 'manager@demo.cafe', name: 'Mia (manager)', role: 'MANAGER' },
      org: { id: demoOrgId, slug: 'demo-cafe', name: 'Demo Café' },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { cognitoSub: DEV_USERS.manager.sub },
    });
    expect(user).toMatchObject({ role: 'MANAGER', orgId: demoOrgId });
  });

  it('staff can use inventory, but not the manager-only forecast', async () => {
    const token = await login('staff');
    const created = await request(app)
      .post('/api/suppliers')
      .set(bearer(token))
      .send({ name: 'Bean Bros' });
    expect(created.status).toBe(201);
    expect((await request(app).get('/api/items').set(bearer(token))).status).toBe(200);

    const forecast = await request(app).get('/api/forecast/latest-run').set(bearer(token));
    expect(forecast.status).toBe(403);
    expect(forecast.body.error).toEqual({
      code: 'FORBIDDEN',
      message: 'Only managers can see this.',
    });
  });

  it('managers reach the forecast', async () => {
    const token = await login('manager');
    const empty = await request(app).get('/api/forecast/latest-run').set(bearer(token));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ run: null });

    await prisma.forecastRun.create({
      data: {
        orgId: demoOrgId,
        modelTag: 'lgbm-v3',
        modelKind: 'ML',
        status: 'SUCCEEDED',
        mapeModel: 0.164,
        mapeBaseline: 0.241,
        startedAt: new Date(Date.now() - 60_000),
        finishedAt: new Date(),
      },
    });
    const res = await request(app).get('/api/forecast/latest-run').set(bearer(token));
    expect(res.body.run).toMatchObject({ modelTag: 'lgbm-v3', mapeModel: 0.164 });
  });

  it('records who made each stock change', async () => {
    const token = await login('staff');
    const item = await prisma.item.create({
      data: { orgId: demoOrgId, name: 'Whole milk', category: 'Dairy', unit: 'L' },
    });
    await request(app)
      .post('/api/stock/movements')
      .set(bearer(token))
      .send({ itemId: item.id, type: 'RECEIVE', quantity: 10 });

    const moves = await request(app).get('/api/stock/movements').set(bearer(token));
    expect(moves.body[0].createdBy).toEqual({
      email: 'staff@demo.cafe',
      displayName: 'Sam (staff)',
    });
  });

  it('rejects an unknown role', async () => {
    const res = await request(app).post('/auth/dev/login').send({ role: 'owner' });
    expect(res.status).toBe(400);
  });

  it('refuses to place users in a café that does not exist', async () => {
    await resetData(prisma); // no demo org
    const token = await login('staff');
    const res = await request(app).get('/api/me').set(bearer(token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NO_ORG');
  });
});

describe('rejected tokens (401)', () => {
  const app = createApp({ config: loadConfig({}), prisma });
  const stranger = new LocalTokenIssuer(loadConfig({}).auth); // same claims, different key

  it.each([
    ['no Authorization header', undefined, 'AUTH_REQUIRED'],
    ['not a Bearer token', 'Basic abc', 'AUTH_REQUIRED'],
    ['garbage', 'Bearer not.a.jwt', 'INVALID_TOKEN'],
  ])('%s', async (_label, header, code) => {
    const req = request(app).get('/api/suppliers');
    const res = await (header ? req.set('Authorization', header) : req);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(code);
  });

  it('a token signed by someone else’s key', async () => {
    const forged = await stranger.issue({ sub: DEV_USERS.manager.sub, groups: ['manager'] });
    const res = await request(app).get('/api/suppliers').set(bearer(forged));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('an expired token', async () => {
    const res1 = await request(app).post('/auth/dev/login').send({ role: 'manager' });
    // Decode our own valid token's payload, then check the server refuses an expired one
    // by asking the issuer inside the app for a token that expired a minute ago.
    expect(res1.status).toBe(200);
    vi.useFakeTimers({ now: Date.now() + 13 * 3600 * 1000 }); // dev tokens last 12 h
    const res = await request(app).get('/api/suppliers').set(bearer(res1.body.accessToken));
    vi.useRealTimers();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });
});

// ─── Cognito mode, with a local key standing in for the user pool's keys ──────
describe('Cognito sign-in', () => {
  const config = loadConfig({
    COGNITO_USER_POOL_ID: 'us-east-1_TestPool1',
    COGNITO_CLIENT_ID: 'test-client-id',
  });
  const cognito = new LocalTokenIssuer(config.auth); // plays the role of the user pool
  const verifier = createVerifier(config.auth);
  verifier.cacheJwks(cognito.jwks); // instead of downloading AWS's public keys

  // Stand-in for Cognito's GetUser API
  const profiles: Record<string, UserProfile> = {};
  const fetchProfile = vi.fn(async (_token: string, claims: { sub: string }) => {
    const p = profiles[claims.sub];
    if (!p) throw new Error('no such user');
    return p;
  });
  const app = createApp({ config, prisma, verifier, fetchProfile });
  const tokenFor = (sub: string, groups: string[], overrides?: Record<string, unknown>) =>
    cognito.issue({ sub, groups, overrides });

  beforeEach(() => {
    fetchProfile.mockClear();
  });

  it('reports Cognito settings to the web app, and has no dev login', async () => {
    const res = await request(app).get('/auth/config');
    expect(res.body).toEqual({
      mode: 'cognito',
      region: 'us-east-1',
      userPoolId: 'us-east-1_TestPool1',
      clientId: 'test-client-id',
    });
    expect((await request(app).post('/auth/dev/login').send({ role: 'manager' })).status).toBe(404);
  });

  it('takes the café from the user’s Cognito account and scopes all data to it', async () => {
    const cafeB = await makeOrg(prisma, 'Cafe B');
    await prisma.organization.update({ where: { id: cafeB.id }, data: { slug: 'cafe-b' } });
    await prisma.supplier.create({ data: { orgId: demoOrgId, name: 'Demo supplier' } });
    await prisma.supplier.create({ data: { orgId: cafeB.id, name: 'Cafe B supplier' } });
    profiles['sub-b'] = { email: 'Barista@CafeB.sg', orgSlug: 'cafe-b' };

    const token = await tokenFor('sub-b', ['staff']);
    const res = await request(app).get('/api/suppliers').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.map((s: { name: string }) => s.name)).toEqual(['Cafe B supplier']);

    const me = await request(app).get('/api/me').set(bearer(token));
    expect(me.body).toMatchObject({
      user: { email: 'barista@cafeb.sg', role: 'STAFF' }, // email stored lower-case
      org: { slug: 'cafe-b' },
    });
  });

  it('asks Cognito for the profile only on the first request', async () => {
    profiles['sub-1'] = { email: 'amy@demo.cafe' };
    const token = await tokenFor('sub-1', ['staff']);
    await request(app).get('/api/me').set(bearer(token));
    await request(app).get('/api/me').set(bearer(token));
    expect(fetchProfile).toHaveBeenCalledTimes(1);
  });

  it('users without a café attribute join the default (demo) café', async () => {
    profiles['sub-2'] = { email: 'ben@demo.cafe' };
    const me = await request(app)
      .get('/api/me')
      .set(bearer(await tokenFor('sub-2', ['manager'])));
    expect(me.body.org.id).toBe(demoOrgId);
  });

  it('follows group changes: promoted to manager → forecast unlocks', async () => {
    profiles['sub-3'] = { email: 'cara@demo.cafe' };
    const asStaff = await tokenFor('sub-3', ['staff']);
    expect((await request(app).get('/api/forecast/latest-run').set(bearer(asStaff))).status).toBe(
      403,
    );

    const asManager = await tokenFor('sub-3', ['staff', 'manager']);
    expect((await request(app).get('/api/forecast/latest-run').set(bearer(asManager))).status).toBe(
      200,
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { cognitoSub: 'sub-3' } });
    expect(user.role).toBe('MANAGER');
  });

  it('403s an account that is in no group yet', async () => {
    profiles['sub-4'] = { email: 'new@demo.cafe' };
    const res = await request(app)
      .get('/api/suppliers')
      .set(bearer(await tokenFor('sub-4', [])));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NO_ROLE');
  });

  it('links a person added by email before their first sign-in', async () => {
    const pre = await prisma.user.create({
      data: { orgId: demoOrgId, email: 'dee@demo.cafe', role: 'STAFF' },
    });
    profiles['sub-5'] = { email: 'dee@demo.cafe', name: 'Dee' };
    await request(app)
      .get('/api/me')
      .set(bearer(await tokenFor('sub-5', ['staff'])));
    const linked = await prisma.user.findUniqueOrThrow({ where: { id: pre.id } });
    expect(linked).toMatchObject({ cognitoSub: 'sub-5', displayName: 'Dee' });
    expect(await prisma.user.count()).toBe(1);
  });

  it.each([
    ['an ID token instead of an access token', { token_use: 'id' }],
    ['a token for a different app client', { client_id: 'someone-elses-app' }],
    [
      'a token from a different user pool',
      { iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Other' },
    ],
  ])('rejects %s', async (_label, overrides) => {
    profiles['sub-6'] = { email: 'eve@demo.cafe' };
    const res = await request(app)
      .get('/api/suppliers')
      .set(bearer(await tokenFor('sub-6', ['manager'], overrides)));
    expect(res.status).toBe(401);
  });
});
