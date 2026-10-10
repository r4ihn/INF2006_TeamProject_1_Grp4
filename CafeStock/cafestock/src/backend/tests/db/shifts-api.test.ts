// Staff scheduling: shifts, the team list, who can see and change what, and double-booking.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { seedDemoOrg } from '../../src/db/seed.js';
import { addDays, dateInTimeZone, mondayOf } from '../../src/lib/dates.js';
import { testAuthenticator } from './test-auth.js';
import { createTestPrisma, makeOrg, resetData } from './test-db.js';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());

const app = createApp({ config: loadConfig({}), prisma, authenticate: testAuthenticator });

let orgA: string;
let orgB: string;
let mia: string; // manager, org A
let aisha: string; // staff, org A
let ben: string; // staff, org A
let zed: string; // staff, org B
/** Monday of next week (Singapore time), so every shift here is in the future */
let mon: string;
const day = (n: number) => addDays(mon, n);

const person = (orgId: string, email: string, displayName: string, role = 'STAFF' as const) =>
  prisma.user.create({ data: { orgId, email, displayName, role } });

beforeEach(async () => {
  await resetData(prisma);
  orgA = (await makeOrg(prisma, 'Cafe A')).id;
  orgB = (await makeOrg(prisma, 'Cafe B')).id;
  mia = (
    await prisma.user.create({
      data: { orgId: orgA, email: 'mia@a.cafe', displayName: 'Mia', role: 'MANAGER' },
    })
  ).id;
  aisha = (await person(orgA, 'aisha@a.cafe', 'Aisha Tan')).id;
  ben = (await person(orgA, 'ben@a.cafe', 'Ben Lim')).id;
  zed = (await person(orgB, 'zed@b.cafe', 'Zed')).id;
  mon = addDays(mondayOf(dateInTimeZone(new Date(), 'Asia/Singapore')), 7);
});

const asManager = () => ({ 'x-test-org': orgA, 'x-test-user': mia });
const asStaff = (userId: string) => ({
  'x-test-org': orgA,
  'x-test-user': userId,
  'x-test-role': 'STAFF',
});
const asOtherCafe = () => ({ 'x-test-org': orgB });

const shift = (body: object, as: Record<string, string> = asManager()) =>
  request(app)
    .post('/api/shifts')
    .set(as)
    .send({ date: day(0), start: '09:00', end: '15:00', position: 'Barista', ...body });
const week = (as: Record<string, string> = asManager(), from = mon) =>
  request(app).get(`/api/shifts?from=${from}`).set(as);

describe('adding shifts', () => {
  it('stores café-local times as real instants and returns them in café time', async () => {
    const res = await shift({ userId: aisha, note: 'Open the till' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      date: day(0),
      start: '09:00',
      end: '15:00',
      hours: 6,
      position: 'Barista',
      note: 'Open the till',
      assignee: { id: aisha, name: 'Aisha Tan' },
    });
    // 09:00 in Singapore (UTC+8) is 01:00 UTC
    expect(res.body.startsAt).toBe(`${day(0)}T01:00:00.000Z`);
    const row = await prisma.shift.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row).toMatchObject({ orgId: orgA, userId: aisha, createdById: mia });
  });

  it('can leave a shift open for someone to be found later', async () => {
    const res = await shift({ userId: null, position: 'Cashier' });
    expect(res.status).toBe(201);
    expect(res.body.assignee).toBeNull();
  });

  it('accepts 24:00 for a shift that closes the café at midnight', async () => {
    const res = await shift({ userId: ben, start: '18:00', end: '24:00' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ start: '18:00', end: '24:00', hours: 6 });
    expect(res.body.endsAt).toBe(`${day(0)}T16:00:00.000Z`); // midnight SGT
  });

  it.each([
    [{ start: '15:00', end: '09:00' }, 'end', 'End must be after the start'],
    [{ start: '09:00', end: '09:10' }, 'end', 'A shift must be at least 15 minutes long'],
    [{ start: '06:00', end: '23:00' }, 'end', 'A shift can be at most 16 hours long'],
    [{ start: '9am' }, 'start', 'Use a 24-hour time like 09:00'],
    [{ end: '25:00' }, 'end', 'Use a 24-hour time like 17:30'],
    [{ position: '  ' }, 'position', 'Position is required'],
    [{ date: '2026-02-30' }, 'date', 'Choose a date (YYYY-MM-DD)'],
    [{ userId: 'not-a-uuid' }, 'userId', 'Choose an option from the list'],
  ])('rejects %j', async (body, field, message) => {
    const res = await shift(body);
    expect(res.status).toBe(400);
    expect(res.body.error.fields[field]).toContain(message);
    expect(await prisma.shift.count()).toBe(0);
  });

  it('rejects dates more than a year away', async () => {
    const res = await shift({ date: addDays(mon, 400) });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.date).toBe('Choose a date within a year of today');
  });

  it('does not let the client pick the café or the stored instants', async () => {
    const res = await shift({ orgId: orgB, startsAt: new Date().toISOString() });
    expect(res.status).toBe(400);
  });

  it('only assigns people on this café’s roster', async () => {
    const otherCafe = await shift({ userId: zed });
    expect(otherCafe.status).toBe(400);
    expect(otherCafe.body.error.fields.userId).toBe(
      'Choose someone on your team, or leave the shift open',
    );

    await prisma.user.update({ where: { id: ben }, data: { onRoster: false } });
    expect((await shift({ userId: ben })).status).toBe(400);
  });
});

describe('nobody is booked twice at once', () => {
  it('refuses an overlapping shift for the same person, with a clear reason', async () => {
    expect((await shift({ userId: aisha })).status).toBe(201);

    const res = await shift({ userId: aisha, start: '14:00', end: '18:00', position: 'Cashier' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SHIFT_CLASH');
    expect(res.body.error.message).toMatch(/^Aisha Tan is already working 09:00–15:00 on \w{3} /);
    expect(res.body.error.fields.userId).toBe(res.body.error.message);
  });

  it('allows back-to-back shifts, other people at the same time, and open shifts', async () => {
    expect((await shift({ userId: aisha })).status).toBe(201);
    expect((await shift({ userId: aisha, start: '15:00', end: '18:00' })).status).toBe(201);
    expect((await shift({ userId: ben })).status).toBe(201);
    expect((await shift({ userId: null })).status).toBe(201);
    expect((await shift({ userId: null })).status).toBe(201);
  });

  it('holds when two managers book the same person at the same moment', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        shift({ userId: aisha, start: `0${i + 1}:00`, end: '12:00' }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    expect(await prisma.shift.count({ where: { userId: aisha } })).toBe(1);
  });
});

describe('seeing the roster', () => {
  beforeEach(async () => {
    await shift({ userId: aisha }); // Mon 6 h
    await shift({ userId: aisha, date: day(2), start: '12:00', end: '20:00' }); // Wed 8 h
    await shift({ userId: ben, date: day(1), start: '07:00', end: '11:30' }); // Tue 4.5 h
    await shift({ userId: null, date: day(5), position: 'Cashier' }); // Sat, open
    await shift({ userId: ben, date: day(7) }); // the week after — not in this week
  });

  it('managers see every shift in the week, with hours per person and totals', async () => {
    const res = await week();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      from: mon,
      to: day(6),
      days: 7,
      timezone: 'Asia/Singapore',
      weeklyHoursLimit: 44,
      totals: { shifts: 4, hours: 24.5, open: 1 },
    });
    expect(res.body.shifts.map((s: { date: string }) => s.date)).toEqual([
      day(0),
      day(1),
      day(2),
      day(5),
    ]);
    // Everyone on the roster is listed, including people with no shifts (Mia)
    expect(res.body.people).toEqual([
      { userId: aisha, name: 'Aisha Tan', onRoster: true, shifts: 2, hours: 14 },
      { userId: ben, name: 'Ben Lim', onRoster: true, shifts: 1, hours: 4.5 },
      { userId: mia, name: 'Mia', onRoster: true, shifts: 0, hours: 0 },
    ]);
  });

  it('staff see only their own shifts — not colleagues’, not open ones', async () => {
    const res = await week(asStaff(ben));

    expect(res.status).toBe(200);
    expect(res.body.shifts).toHaveLength(1);
    expect(res.body.shifts[0]).toMatchObject({ date: day(1), assignee: { id: ben } });
    expect(res.body.totals).toEqual({ shifts: 1, hours: 4.5, open: 0 });
    expect(res.body.people).toEqual([]);
  });

  it('a manager can ask for just their own shifts', async () => {
    const res = await request(app).get(`/api/shifts?from=${mon}&mine=true`).set(asManager());
    expect(res.body.shifts).toEqual([]);
    expect(res.body.people).toEqual([]);
  });

  it('can show a longer period, up to six weeks', async () => {
    const res = await request(app).get(`/api/shifts?from=${mon}&days=14`).set(asManager());
    expect(res.body.totals.shifts).toBe(5);
    expect(res.body.to).toBe(day(13));
    expect((await request(app).get('/api/shifts?days=43').set(asManager())).status).toBe(400);
  });

  it('defaults to the current week', async () => {
    const res = await request(app).get('/api/shifts').set(asManager());
    expect(res.body.from).toBe(addDays(mon, -7));
  });

  it('never shows another café’s shifts', async () => {
    const res = await week(asOtherCafe());
    expect(res.body.shifts).toEqual([]);
    expect(res.body.people.map((p: { name: string }) => p.name)).toEqual(['Zed']);
  });
});

describe('changing and removing shifts', () => {
  it('moves a shift, keeping whatever was not sent', async () => {
    const { body } = await shift({ userId: aisha, note: 'Keys' });
    const res = await request(app)
      .patch(`/api/shifts/${body.id}`)
      .set(asManager())
      .send({ start: '10:00', date: day(3) });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      date: day(3),
      start: '10:00',
      end: '15:00',
      hours: 5,
      note: 'Keys',
      assignee: { id: aisha },
    });
  });

  it('checks the edited shift against the person’s other shifts, not itself', async () => {
    const first = await shift({ userId: aisha });
    const other = await shift({ userId: ben, start: '16:00', end: '20:00' });

    const longer = await request(app)
      .patch(`/api/shifts/${first.body.id}`)
      .set(asManager())
      .send({ end: '17:00' });
    expect(longer.status).toBe(200);

    const swap = await request(app)
      .patch(`/api/shifts/${other.body.id}`)
      .set(asManager())
      .send({ userId: aisha });
    expect(swap.status).toBe(409);
    expect(swap.body.error.message).toMatch(/^Aisha Tan is already working 09:00–17:00/);
  });

  it('can turn a shift back into an open one', async () => {
    const { body } = await shift({ userId: aisha });
    const res = await request(app)
      .patch(`/api/shifts/${body.id}`)
      .set(asManager())
      .send({ userId: null });
    expect(res.body.assignee).toBeNull();
  });

  it('rejects an edit that makes the times invalid', async () => {
    const { body } = await shift({ userId: aisha });
    const res = await request(app)
      .patch(`/api/shifts/${body.id}`)
      .set(asManager())
      .send({ end: '08:00' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.end).toMatch(/End must be after the start/);
  });

  it('deletes a shift', async () => {
    const { body } = await shift({ userId: aisha });
    const del = await request(app).delete(`/api/shifts/${body.id}`).set(asManager());
    expect(del.status).toBe(204);
    const again = await request(app).delete(`/api/shifts/${body.id}`).set(asManager());
    expect(again.status).toBe(404);
  });

  it('another café can neither change nor delete it', async () => {
    const { body } = await shift({ userId: aisha });
    const patch = await request(app)
      .patch(`/api/shifts/${body.id}`)
      .set(asOtherCafe())
      .send({ position: 'Hacked' });
    expect(patch.status).toBe(404);
    expect((await request(app).delete(`/api/shifts/${body.id}`).set(asOtherCafe())).status).toBe(
      404,
    );
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: body.id } })).position).toBe(
      'Barista',
    );
  });
});

describe('staff cannot change the roster', () => {
  it('refuses adding, changing, deleting and copying shifts, and the team list', async () => {
    const { body } = await shift({ userId: aisha });
    const staff = asStaff(aisha);

    const attempts = [
      await shift({ userId: aisha, date: day(1) }, staff),
      await request(app).patch(`/api/shifts/${body.id}`).set(staff).send({ end: '18:00' }),
      await request(app).delete(`/api/shifts/${body.id}`).set(staff),
      await request(app).post('/api/shifts/copy-week').set(staff).send({ from: mon }),
      await request(app).get('/api/team').set(staff),
      await request(app).post('/api/team').set(staff).send({ name: 'X', email: 'x@a.cafe' }),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(await prisma.shift.count()).toBe(1);
  });
});

describe('copying a week', () => {
  it('copies every shift into the next week, and skips what is already there', async () => {
    await shift({ userId: aisha });
    await shift({ userId: ben, date: day(4), start: '16:00', end: '24:00' });
    await shift({ userId: null, date: day(6), position: 'Cashier' });

    const res = await request(app)
      .post('/api/shifts/copy-week')
      .set(asManager())
      .send({ from: day(3) }); // any day in the week works
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: mon, to: day(7), copied: 3, opened: 0, skipped: [] });

    const next = await week(asManager(), day(7));
    expect(
      next.body.shifts.map((s: { date: string; start: string; end: string }) => [
        s.date,
        s.start,
        s.end,
      ]),
    ).toEqual([
      [day(7), '09:00', '15:00'],
      [day(11), '16:00', '24:00'],
      [day(13), '09:00', '15:00'],
    ]);

    const again = await request(app)
      .post('/api/shifts/copy-week')
      .set(asManager())
      .send({ from: mon });
    expect(again.body.copied).toBe(0);
    expect(again.body.skipped).toHaveLength(3);
    expect(again.body.skipped[0].reason).toBe('Already on the roster');
  });

  it('opens shifts of people who left, and skips ones that would double-book someone', async () => {
    await shift({ userId: aisha });
    await shift({ userId: ben, date: day(1) });
    await shift({ userId: aisha, date: day(7), start: '12:00', end: '20:00' }); // already busy
    await prisma.user.update({ where: { id: ben }, data: { onRoster: false } });

    const res = await request(app)
      .post('/api/shifts/copy-week')
      .set(asManager())
      .send({ from: mon });
    expect(res.body).toMatchObject({ copied: 1, opened: 1 });
    expect(res.body.skipped).toEqual([
      expect.objectContaining({
        date: day(7),
        name: 'Aisha Tan',
        reason: expect.stringMatching(/^Aisha Tan is already working 12:00–20:00/),
      }),
    ]);
    const open = await prisma.shift.findFirstOrThrow({ where: { userId: null } });
    expect(open.position).toBe('Barista');
  });
});

describe('the team list', () => {
  it('lists the roster by name, marking who has signed in and who you are', async () => {
    await prisma.user.update({ where: { id: mia }, data: { cognitoSub: 'sub-mia' } });
    const res = await request(app).get('/api/team').set(asManager());

    expect(res.status).toBe(200);
    expect(res.body.map((m: { name: string }) => m.name)).toEqual(['Aisha Tan', 'Ben Lim', 'Mia']);
    expect(res.body[2]).toMatchObject({ role: 'MANAGER', signedIn: true, isYou: true });
    expect(res.body[0]).toMatchObject({ role: 'STAFF', signedIn: false, isYou: false });
  });

  it('adds someone by name and email, once', async () => {
    const res = await request(app)
      .post('/api/team')
      .set(asManager())
      .send({ name: 'Chloe Ng', email: ' Chloe@A.Cafe ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Chloe Ng', email: 'chloe@a.cafe', signedIn: false });

    const dup = await request(app)
      .post('/api/team')
      .set(asManager())
      .send({ name: 'Chloe', email: 'chloe@a.cafe' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields.email).toBe('Someone with this email is already on your team');
  });

  it('removing someone keeps their past shifts but opens their upcoming ones', async () => {
    await shift({ userId: ben });
    await shift({ userId: ben, date: day(2) });
    const past = await prisma.shift.create({
      data: {
        orgId: orgA,
        userId: ben,
        position: 'Barista',
        startsAt: new Date(Date.now() - 3 * 86_400_000),
        endsAt: new Date(Date.now() - 3 * 86_400_000 + 4 * 3_600_000),
      },
    });

    const res = await request(app)
      .patch(`/api/team/${ben}`)
      .set(asManager())
      .send({ onRoster: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ onRoster: false, openedShifts: 2 });
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: past.id } })).userId).toBe(ben);
    expect(await prisma.shift.count({ where: { userId: null } })).toBe(2);

    const list = await request(app).get('/api/team').set(asManager());
    expect(list.body.map((m: { name: string }) => m.name)).not.toContain('Ben Lim');
    const all = await request(app).get('/api/team?all=true').set(asManager());
    expect(all.body.map((m: { name: string }) => m.name)).toContain('Ben Lim');

    // Adding the same email again brings the same person back
    const back = await request(app)
      .post('/api/team')
      .set(asManager())
      .send({ name: 'Ben Lim', email: 'ben@a.cafe' });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ id: ben, onRoster: true });
  });

  it('cannot touch another café’s people', async () => {
    const res = await request(app)
      .patch(`/api/team/${zed}`)
      .set(asManager())
      .send({ name: 'Mine now' });
    expect(res.status).toBe(404);
  });
});

// End to end with real (development) sign-in: the owner rosters someone before they have
// ever signed in; on their first sign-in they are linked and see the shift.
describe('a shift created by the manager appears in the employee’s own view', () => {
  const devApp = createApp({ config: loadConfig({}), prisma });
  const login = async (role: 'staff' | 'manager') =>
    (await request(devApp).post('/auth/dev/login').send({ role })).body.accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('links the rostered person on first sign-in', async () => {
    await seedDemoOrg(prisma);
    const manager = await login('manager');
    const added = await request(devApp)
      .post('/api/team')
      .set(bearer(manager))
      .send({ name: 'Sam Lee', email: 'staff@demo.cafe' });
    expect(added.status).toBe(201);
    const created = await request(devApp).post('/api/shifts').set(bearer(manager)).send({
      date: mon,
      start: '08:00',
      end: '14:00',
      position: 'Barista',
      userId: added.body.id,
    });
    expect(created.status).toBe(201);

    const staff = await login('staff');
    const me = await request(devApp).get('/api/me').set(bearer(staff));
    expect(me.body.user.id).toBe(added.body.id);
    const mine = await request(devApp).get(`/api/shifts?from=${mon}`).set(bearer(staff));
    expect(mine.body.shifts).toEqual([
      expect.objectContaining({ id: created.body.id, date: mon, start: '08:00', end: '14:00' }),
    ]);
  });
});
