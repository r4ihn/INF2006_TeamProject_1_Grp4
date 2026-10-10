import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Shift, ShiftsPayload, TeamMember } from '../api';
import { jsonResponse, renderWithProviders, signedInAs } from '../test/render';
import { RosterPage } from './RosterPage';
import {
  addDays,
  addMonths,
  dayHeading,
  formatHours,
  mondayOf,
  monthGridStart,
  monthLabel,
  todayIn,
  weekLabel,
} from './dates';
import { validateShift } from './validation';

// Wednesday 7 Oct 2026, 10:00 in Singapore → this week is Mon 5 – Sun 11 Oct
const NOW = new Date('2026-10-07T02:00:00.000Z');
const MON = '2026-10-05';

const member = (id: string, name: string, extra: Partial<TeamMember> = {}): TeamMember => ({
  id,
  name,
  email: `${name.split(' ')[0]!.toLowerCase()}@demo.cafe`,
  role: 'STAFF',
  signedIn: true,
  onRoster: true,
  isYou: false,
  ...extra,
});

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

type Row = Omit<Shift, 'startsAt' | 'endsAt' | 'hours' | 'assignee'> & { userId: string | null };

/**
 * An in-memory stand-in for /api/shifts and /api/team with the rules the page relies on:
 * staff get only their own shifts, a person can't be booked twice at once (409).
 */
function installRosterApi({
  shifts = [] as Omit<Row, 'id' | 'note'>[],
  team = [] as TeamMember[],
  me = 'u-manager',
} = {}) {
  let next = 1;
  const rows: Row[] = shifts.map((s) => ({ id: `s${next++}`, note: null, ...s }));
  const people = [...team];
  const calls: { method: string; path: string; body?: unknown }[] = [];

  const dto = (r: Row): Shift => {
    const p = people.find((m) => m.id === r.userId);
    return {
      id: r.id,
      date: r.date,
      start: r.start,
      end: r.end,
      startsAt: `${r.date}T${r.start}:00+08:00`,
      endsAt: `${r.date}T${r.end}:00+08:00`,
      hours: (minutes(r.end) - minutes(r.start)) / 60,
      position: r.position,
      note: r.note,
      assignee: p ? { id: p.id, name: p.name, onRoster: p.onRoster } : null,
    };
  };
  const clash = (r: Omit<Row, 'id'>, except?: string) =>
    rows.find(
      (o) =>
        o.id !== except &&
        r.userId &&
        o.userId === r.userId &&
        o.date === r.date &&
        minutes(o.start) < minutes(r.end) &&
        minutes(o.end) > minutes(r.start),
    );
  const clashResponse = (o: Row) => {
    const message = `${people.find((m) => m.id === o.userId)!.name} is already working ${o.start}–${o.end} on ${dayHeading(o.date)}.`;
    return jsonResponse(
      { error: { code: 'SHIFT_CLASH', message, fields: { userId: message } } },
      409,
    );
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    const staff = !people.some((m) => m.id === me && m.role === 'MANAGER') && me !== 'u-manager';

    if (url.pathname === '/api/shifts' && method === 'GET') {
      const from = url.searchParams.get('from')!;
      const span = Number(url.searchParams.get('days') ?? 7);
      const until = addDays(from, span);
      const inWeek = rows
        .filter((r) => r.date >= from && r.date < until && (!staff || r.userId === me))
        .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
        .map(dto);
      const payload: ShiftsPayload = {
        from,
        to: addDays(from, span - 1),
        days: span,
        timezone: 'Asia/Singapore',
        weeklyHoursLimit: 44,
        totals: {
          shifts: inWeek.length,
          hours: inWeek.reduce((sum, s) => sum + s.hours, 0),
          open: inWeek.filter((s) => !s.assignee).length,
        },
        shifts: inWeek,
        people: staff
          ? []
          : people
              .filter((m) => m.onRoster)
              .map((m) => {
                const theirs = inWeek.filter((s) => s.assignee?.id === m.id);
                return {
                  userId: m.id,
                  name: m.name,
                  onRoster: true,
                  shifts: theirs.length,
                  hours: theirs.reduce((sum, s) => sum + s.hours, 0),
                };
              }),
      };
      return jsonResponse(payload);
    }
    if (url.pathname === '/api/shifts' && method === 'POST') {
      const row: Row = { id: `s${next++}`, ...body, note: body.note || null };
      const other = clash(row);
      if (other) return clashResponse(other);
      rows.push(row);
      return jsonResponse(dto(row), 201);
    }
    if (url.pathname === '/api/shifts/copy-week') {
      const from = mondayOf(body.from);
      const copies = rows
        .filter((r) => r.date >= from && r.date < addDays(from, 7))
        .map((r) => ({ ...r, id: `s${next++}`, date: addDays(r.date, 7) }));
      rows.push(...copies);
      return jsonResponse({
        from,
        to: addDays(from, 7),
        sourceCount: copies.length,
        copied: copies.length,
        opened: 0,
        skipped: [
          {
            date: addDays(from, 9),
            start: '09:00',
            end: '15:00',
            name: 'Ben Lim',
            reason: 'Ben Lim is already working 08:00–12:00 on Wed 14 Oct.',
          },
        ],
      });
    }
    const shiftMatch = /^\/api\/shifts\/([\w-]+)$/.exec(url.pathname);
    if (shiftMatch) {
      const row = rows.find((r) => r.id === shiftMatch[1]);
      if (!row)
        return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Shift not found' } }, 404);
      if (method === 'DELETE') {
        rows.splice(rows.indexOf(row), 1);
        return jsonResponse(null, 204);
      }
      const merged = { ...row, ...body, note: body.note ?? row.note };
      const other = clash(merged, row.id);
      if (other) return clashResponse(other);
      Object.assign(row, merged);
      return jsonResponse(dto(row));
    }
    if (url.pathname === '/api/team' && method === 'GET') {
      return jsonResponse(people.filter((m) => m.onRoster));
    }
    if (url.pathname === '/api/team' && method === 'POST') {
      if (people.some((m) => m.email === body.email)) {
        return jsonResponse(
          {
            error: {
              code: 'CONFLICT',
              message: 'This person is already on your team',
              fields: { email: 'Someone with this email is already on your team' },
            },
          },
          409,
        );
      }
      const m = member(`u${next++}`, body.name, { email: body.email, signedIn: false });
      people.push(m);
      return jsonResponse(m, 201);
    }
    const teamMatch = /^\/api\/team\/([\w-]+)$/.exec(url.pathname);
    if (teamMatch) {
      const m = people.find((p) => p.id === teamMatch[1])!;
      Object.assign(m, { onRoster: body.onRoster });
      let opened = 0;
      for (const r of rows) {
        if (r.userId === m.id) {
          r.userId = null;
          opened += 1;
        }
      }
      return jsonResponse({ ...m, openedShifts: opened });
    }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls, rows };
}

const TEAM = [
  member('u-manager', 'Mia Wong', { role: 'MANAGER', isYou: true }),
  member('u-aisha', 'Aisha Tan'),
  member('u-ben', 'Ben Lim', { signedIn: false }),
];

const WEEK = [
  { date: MON, start: '09:00', end: '15:00', position: 'Barista', userId: 'u-aisha' },
  { date: addDays(MON, 1), start: '07:00', end: '11:30', position: 'Opening', userId: 'u-ben' },
  { date: addDays(MON, 5), start: '12:00', end: '18:00', position: 'Cashier', userId: null },
];

const dayColumn = async (iso: string) =>
  within(await screen.findByRole('region', { name: dayHeading(iso) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('calendar helpers', () => {
  it('works in the café’s time zone and labels weeks readably', () => {
    // 23:30 on Sunday 11 Oct in Singapore is still Sunday there, though Monday nowhere else matters
    expect(todayIn('Asia/Singapore', new Date('2026-10-11T15:30:00Z'))).toBe('2026-10-11');
    expect(mondayOf('2026-10-11')).toBe(MON);
    expect(mondayOf(MON)).toBe(MON);
    expect(weekLabel(MON)).toBe('5 – 11 Oct 2026');
    expect(weekLabel('2026-09-28')).toBe('28 Sep – 4 Oct 2026');
    expect(weekLabel('2025-12-29')).toBe('29 Dec 2025 – 4 Jan 2026');
    expect(formatHours(4.5)).toBe('4.5 h');
    expect(formatHours(6)).toBe('6 h');
  });

  it('checks a shift before sending it', () => {
    const ok = {
      date: MON,
      start: '09:00',
      end: '15:00',
      position: 'Barista',
      userId: null,
      note: '',
    };
    expect(validateShift(ok)).toEqual({});
    expect(validateShift({ ...ok, end: '24:00' })).toEqual({});
    expect(validateShift({ ...ok, end: '08:00' }).end).toBe('End must be after the start');
    expect(validateShift({ ...ok, end: '09:10' }).end).toBe(
      'A shift must be at least 15 minutes long',
    );
    expect(validateShift({ ...ok, start: '06:00', end: '23:00' }).end).toBe(
      'A shift can be at most 16 hours long',
    );
    expect(validateShift({ ...ok, position: ' ' }).position).toBe('Position is required');
  });
});

describe('RosterPage — manager', () => {
  const renderRoster = (route = '/roster') =>
    renderWithProviders(<RosterPage />, { route, auth: signedInAs('MANAGER') });

  it('shows the week: each shift in its day, totals, and hours per person', async () => {
    installRosterApi({ shifts: WEEK, team: TEAM });
    renderRoster();

    expect(await screen.findByRole('heading', { name: '5 – 11 Oct 2026' })).toBeInTheDocument();
    const monday = await dayColumn(MON);
    expect(
      await monday.findByRole('button', {
        name: 'Edit shift: Mon 5 Oct 09:00–15:00, Barista, Aisha Tan',
      }),
    ).toBeInTheDocument();
    expect((await dayColumn(addDays(MON, 1))).getByText('Ben Lim')).toBeInTheDocument();
    expect((await dayColumn(addDays(MON, 5))).getByText('Open shift')).toBeInTheDocument();
    expect((await dayColumn(addDays(MON, 2))).getByText('Today')).toBeInTheDocument();

    const stats = screen.getByText('Open shifts:').closest('dl')!;
    expect(stats).toHaveTextContent('Shifts:3');
    expect(stats).toHaveTextContent('Hours:16.5 h');
    expect(stats).toHaveTextContent('Open shifts:1');

    const hours = within(screen.getByRole('table', { name: 'Hours this week' }));
    expect(hours.getByText('Aisha Tan').closest('tr')).toHaveTextContent('6 h');
    expect(hours.getByText('Ben Lim').closest('tr')).toHaveTextContent('4.5 h');
    expect(hours.getByText('Mia Wong').closest('tr')).toHaveTextContent('0 h');
  });

  it('flags anyone planned for more than 44 hours in the week', async () => {
    const long = Array.from({ length: 5 }, (_, i) => ({
      date: addDays(MON, i),
      start: '08:00',
      end: '17:30',
      position: 'Barista',
      userId: 'u-aisha',
    }));
    installRosterApi({ shifts: long, team: TEAM });
    renderRoster();

    const hours = within(await screen.findByRole('table', { name: 'Hours this week' }));
    const row = hours.getByText('Aisha Tan').closest('tr')!;
    expect(row).toHaveTextContent('47.5 h');
    expect(within(row).getByText('Over 44 h')).toBeInTheDocument();
  });

  it('moves between weeks, and remembers the week in the address', async () => {
    const { calls } = installRosterApi({ shifts: WEEK, team: TEAM });
    const user = userEvent.setup();
    renderRoster();

    expect(await screen.findByRole('button', { name: 'This week' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(await screen.findByRole('heading', { name: '12 – 18 Oct 2026' })).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/shifts?from=2026-10-12&days=7')).toBe(true);
    expect(await screen.findByText('Shifts:')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'This week' }));
    expect(await screen.findByRole('heading', { name: '5 – 11 Oct 2026' })).toBeInTheDocument();
  });

  it('opens a deep-linked week', async () => {
    installRosterApi({ shifts: WEEK, team: TEAM });
    renderRoster('/roster?week=2026-09-30');
    expect(await screen.findByRole('heading', { name: '28 Sep – 4 Oct 2026' })).toBeInTheDocument();
  });

  it('adds a shift from a day column', async () => {
    const { calls } = installRosterApi({ shifts: WEEK, team: TEAM });
    const user = userEvent.setup();
    renderRoster();

    await user.click(await screen.findByRole('button', { name: 'Add shift on Thu 8 Oct' }));
    const form = within(screen.getByRole('form', { name: 'Add a shift' }));
    expect(form.getByLabelText(/^Date/)).toHaveValue('2026-10-08');
    await user.selectOptions(form.getByLabelText('Who'), 'Aisha Tan');
    await user.type(form.getByLabelText(/^Position/), 'Barista');
    fireEvent.change(form.getByLabelText(/^Start/), { target: { value: '10:00' } });
    fireEvent.change(form.getByLabelText(/^End/), { target: { value: '16:30' } });
    await user.type(form.getByLabelText('Note'), 'Stock count at close');
    await user.click(form.getByRole('button', { name: 'Add shift' }));

    expect(
      await screen.findByText('Added Aisha Tan: Thu 8 Oct 10:00–16:30, Barista.'),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      date: '2026-10-08',
      start: '10:00',
      end: '16:30',
      position: 'Barista',
      userId: 'u-aisha',
      note: 'Stock count at close',
    });
    expect(
      await (
        await dayColumn('2026-10-08')
      ).findByRole('button', { name: /10:00–16:30, Barista, Aisha Tan/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Add a shift' })).not.toBeInTheDocument();
  });

  it('adds an open shift that ends at midnight', async () => {
    const { calls } = installRosterApi({ shifts: [], team: TEAM });
    const user = userEvent.setup();
    renderRoster();

    await user.click(await screen.findByRole('button', { name: '+ Add shift' }));
    const form = within(screen.getByRole('form', { name: 'Add a shift' }));
    expect(form.getByLabelText(/^Date/)).toHaveValue('2026-10-07'); // today
    await user.type(form.getByLabelText(/^Position/), 'Closing');
    fireEvent.change(form.getByLabelText(/^Start/), { target: { value: '18:00' } });
    await user.click(form.getByLabelText('Until midnight'));
    expect(form.getByLabelText(/^End/)).toBeDisabled();
    await user.click(form.getByRole('button', { name: 'Add shift' }));

    expect(
      await screen.findByText('Added Open shift: Wed 7 Oct 18:00–24:00, Closing.'),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      start: '18:00',
      end: '24:00',
      userId: null,
    });
  });

  it('checks the times before sending anything', async () => {
    const { calls } = installRosterApi({ shifts: [], team: TEAM });
    const user = userEvent.setup();
    renderRoster();

    await user.click(await screen.findByRole('button', { name: '+ Add shift' }));
    const form = within(screen.getByRole('form', { name: 'Add a shift' }));
    fireEvent.change(form.getByLabelText(/^End/), { target: { value: '08:00' } });
    await user.click(form.getByRole('button', { name: 'Add shift' }));

    expect(form.getByText('End must be after the start')).toBeInTheDocument();
    expect(form.getByText('Position is required')).toBeInTheDocument();
    expect(form.getByLabelText(/^End/)).toHaveAttribute('aria-invalid', 'true');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('shows why a double booking was refused, next to the person', async () => {
    installRosterApi({ shifts: WEEK, team: TEAM });
    const user = userEvent.setup();
    renderRoster();

    await user.click(await screen.findByRole('button', { name: 'Add shift on Mon 5 Oct' }));
    const form = within(screen.getByRole('form', { name: 'Add a shift' }));
    await user.selectOptions(form.getByLabelText('Who'), 'Aisha Tan');
    await user.type(form.getByLabelText(/^Position/), 'Cashier');
    fireEvent.change(form.getByLabelText(/^Start/), { target: { value: '14:00' } });
    fireEvent.change(form.getByLabelText(/^End/), { target: { value: '18:00' } });
    await user.click(form.getByRole('button', { name: 'Add shift' }));

    expect(
      await form.findByText('Aisha Tan is already working 09:00–15:00 on Mon 5 Oct.'),
    ).toBeInTheDocument();
    expect(form.getByLabelText('Who')).toHaveAttribute('aria-invalid', 'true');
  });

  it('edits a shift: gives it to nobody (open), then deletes it', async () => {
    const { calls } = installRosterApi({ shifts: WEEK, team: TEAM });
    const user = userEvent.setup();
    renderRoster();

    await user.click(await screen.findByRole('button', { name: /^Edit shift: Mon 5 Oct/ }));
    let form = within(screen.getByRole('form', { name: 'Edit shift on Mon 5 Oct' }));
    expect(form.getByLabelText('Who')).toHaveValue('u-aisha');
    await user.selectOptions(form.getByLabelText('Who'), '');
    await user.click(form.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('Saved Open shift: Mon 5 Oct 09:00–15:00, Barista.'),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ userId: null });

    await user.click(
      await screen.findByRole('button', { name: /^Edit shift: Mon 5 Oct.*Open shift$/ }),
    );
    form = within(screen.getByRole('form', { name: 'Edit shift on Mon 5 Oct' }));
    await user.click(form.getByRole('button', { name: 'Delete shift' }));
    await user.click(
      within(form.getByRole('group', { name: 'Confirm deleting this shift' })).getByRole('button', {
        name: 'Delete',
      }),
    );
    expect(
      await screen.findByText('Deleted Open shift: Mon 5 Oct 09:00–15:00.'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/shifts/s1')).toBe(true);
  });

  it('copies the week to the next one and explains anything it skipped', async () => {
    const { calls } = installRosterApi({ shifts: WEEK, team: TEAM });
    const user = userEvent.setup();
    renderRoster();

    await user.click(await screen.findByRole('button', { name: 'Copy to next week' }));
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Copied 3 shifts to the week of 12 – 18 Oct 2026.');
    expect(notice).toHaveTextContent(
      'Ben Lim, Wed 14 Oct 09:00–15:00: Ben Lim is already working 08:00–12:00 on Wed 14 Oct.',
    );
    expect(calls.find((c) => c.path === '/api/shifts/copy-week')?.body).toEqual({ from: MON });

    await user.click(within(notice).getByRole('button', { name: 'Show that week' }));
    expect(await screen.findByRole('heading', { name: '12 – 18 Oct 2026' })).toBeInTheDocument();
    expect(
      await (
        await dayColumn('2026-10-12')
      ).findByRole('button', { name: /09:00–15:00, Barista, Aisha Tan/ }),
    ).toBeInTheDocument();
  });

  it('adds a team member, and removing one opens their shifts', async () => {
    installRosterApi({ shifts: WEEK, team: TEAM });
    const user = userEvent.setup();
    renderRoster();

    const team = within(await screen.findByRole('region', { name: 'Team' }));
    expect(team.getByText('Ben Lim').closest('tr')).toHaveTextContent('Not signed in yet');
    expect(team.getByText('Mia Wong').closest('tr')).toHaveTextContent('You');

    const add = within(team.getByRole('form', { name: 'Add a team member' }));
    await user.type(add.getByLabelText('Name'), 'Chloe Ng');
    await user.type(add.getByLabelText('Email'), 'aisha@demo.cafe');
    await user.click(add.getByRole('button', { name: 'Add to team' }));
    expect(
      await add.findByText('Someone with this email is already on your team'),
    ).toBeInTheDocument();
    await user.clear(add.getByLabelText('Email'));
    await user.type(add.getByLabelText('Email'), 'chloe@demo.cafe');
    await user.click(add.getByRole('button', { name: 'Add to team' }));
    expect(await screen.findByText('Added Chloe Ng to the team.')).toBeInTheDocument();
    expect(await team.findByText('Chloe Ng')).toBeInTheDocument();

    await user.click(team.getByRole('button', { name: 'Remove Ben Lim from the roster' }));
    await user.click(
      within(team.getByRole('group', { name: 'Confirm removing Ben Lim' })).getByRole('button', {
        name: 'Remove',
      }),
    );
    expect(
      await screen.findByText('Removed Ben Lim from the roster. 1 upcoming shift is now open.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(team.queryByText('Ben Lim')).not.toBeInTheDocument());
    expect(await screen.findByText('Open shifts:')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Open shifts:').closest('dl')).toHaveTextContent('Open shifts:2'),
    );
  });
});

describe('RosterPage — staff (My shifts)', () => {
  it('shows only their own shifts, with no way to change the roster', async () => {
    const sam = { date: addDays(MON, 3), start: '08:00', end: '14:00', position: 'Barista' };
    const { calls } = installRosterApi({
      shifts: [...WEEK, { ...sam, userId: 'u-staff-sam' }],
      team: [...TEAM, member('u-staff-sam', 'Sam Lee')],
      me: 'u-staff-sam',
    });
    const auth = signedInAs('STAFF');
    auth.me!.user = { id: 'u-staff-sam', email: 'sam@demo.cafe', name: 'Sam Lee', role: 'STAFF' };
    renderWithProviders(<RosterPage />, { route: '/roster', auth });

    expect(await screen.findByRole('heading', { name: 'My shifts' })).toBeInTheDocument();
    const row = (await screen.findByText('Thu 8 Oct')).closest('tr')!;
    expect(row).toHaveTextContent('08:00–14:00');
    expect(row).toHaveTextContent('Barista');
    expect(screen.getAllByRole('row')).toHaveLength(2); // header + Sam's one shift
    expect(screen.getByText('Hours:').closest('dl')).toHaveTextContent('Hours:6 h');
    expect(screen.queryByRole('button', { name: /Add shift/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy to next week' })).not.toBeInTheDocument();
    expect(calls.map((c) => c.path)).toEqual(['/api/shifts?from=2026-10-05&days=7']);
  });

  it('says so when there are no shifts this week', async () => {
    const { calls } = installRosterApi({ shifts: WEEK, team: TEAM, me: 'u-staff' });
    renderWithProviders(<RosterPage />, { route: '/roster', auth: signedInAs('STAFF') });

    expect(await screen.findByText('No shifts this week')).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/api/team'))).toBe(false);
  });
});

describe('RosterPage — staff calendar views', () => {
  const sam = (date: string, start: string, end: string, position = 'Barista') => ({
    date,
    start,
    end,
    position,
    userId: 'u-staff-sam',
  });
  const renderStaff = (route: string, shifts = [sam(addDays(MON, 3), '08:00', '14:00')]) => {
    const api = installRosterApi({
      shifts,
      team: [...TEAM, member('u-staff-sam', 'Sam Lee')],
      me: 'u-staff-sam',
    });
    const auth = signedInAs('STAFF');
    auth.me!.user = { id: 'u-staff-sam', email: 'sam@demo.cafe', name: 'Sam Lee', role: 'STAFF' };
    renderWithProviders(<RosterPage />, { route, auth });
    return api;
  };

  it('month helpers handle month and year boundaries', () => {
    expect(monthGridStart('2026-10-15')).toBe('2026-09-28');
    expect(monthGridStart('2026-02-10')).toBe('2026-01-26');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01');
    expect(monthLabel('2026-10-15')).toBe('October 2026');
  });

  it('places a shift in its day in the week view', async () => {
    renderStaff('/roster?view=week');
    const shift = await screen.findByRole('button', { name: 'Thu 8 Oct, 08:00–14:00, Barista' });
    expect(shift).toHaveStyle({ top: '0px' });
    await userEvent.click(shift);
    expect(
      within(screen.getByRole('region', { name: 'Shift details' })).getByText(/Barista/),
    ).toBeInTheDocument();
  });

  it('asks for the whole month grid and collapses busy days', async () => {
    const day = addDays(MON, 2);
    const { calls } = renderStaff('/roster?view=month', [
      sam(day, '06:00', '08:00'),
      sam(day, '08:00', '10:00'),
      sam(day, '10:00', '12:00'),
      sam(day, '12:00', '14:00'),
    ]);
    expect(await screen.findByText('+1 more')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    expect(calls[0]!.path).toBe('/api/shifts?from=2026-09-28&days=42');
  });

  it('switches views from the toggle and keeps them in the address', async () => {
    const { calls } = renderStaff('/roster');
    await screen.findByText('Thu 8 Oct');
    await userEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(await screen.findByRole('group', { name: 'Week calendar' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(await screen.findByRole('group', { name: 'Month calendar' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    expect(calls.at(-1)!.path).toBe('/api/shifts?from=2026-10-26&days=42');
  });

  it('gives managers no calendar toggle', async () => {
    installRosterApi({ shifts: WEEK, team: TEAM });
    renderWithProviders(<RosterPage />, {
      route: '/roster?view=month',
      auth: signedInAs('MANAGER'),
    });
    await dayColumn(MON);
    expect(screen.queryByRole('button', { name: 'Month' })).not.toBeInTheDocument();
  });
});
