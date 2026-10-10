import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  ApiError,
  copyWeek,
  createShift,
  deleteShift,
  listShifts,
  listTeam,
  updateShift,
  type Shift,
  type ShiftInput,
  type ShiftsPayload,
} from '../api';
import { useAuth } from '../auth/context';
import { Notice, type NoticeKind } from '../components/Notice';
import { StatLine } from '../components/StatLine';
import {
  addDays,
  addMonths,
  dayHeading,
  formatHours,
  isIsoDate,
  isSameMonth,
  mondayOf,
  monthGridStart,
  monthLabel,
  monthStart,
  todayIn,
  weekLabel,
} from './dates';
import { CalendarMonth } from './CalendarMonth';
import { CalendarWeek } from './CalendarWeek';
import { ShiftForm } from './ShiftForm';
import { COMMON_POSITIONS } from './validation';
import { TeamPanel } from './TeamPanel';

/**
 * Staff scheduling. Managers plan the week (who works when, in which position); staff see
 * only their own shifts. The week shown is in the address (?week=2026-10-05) so it can be
 * bookmarked and survives a refresh.
 */
export function RosterPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const timeZone = me?.org.timezone ?? 'Asia/Singapore';
  const today = todayIn(timeZone);
  const thisWeek = mondayOf(today);
  const isManager = me?.user.role === 'MANAGER';
  const asked = params.get('week');
  const anchor = asked && isIsoDate(asked) ? asked : today;
  // Only staff get the calendar views; managers keep the planning grid.
  const askedView = params.get('view');
  const view: RosterView =
    !isManager && (askedView === 'week' || askedView === 'month') ? askedView : 'list';
  const from = view === 'month' ? monthGridStart(anchor) : mondayOf(anchor);
  const days = view === 'month' ? 42 : 7;
  const goTo = (date: string, nextView: RosterView = view) => {
    const next: Record<string, string> = {};
    const target = nextView === 'month' ? monthStart(date) : mondayOf(date);
    const home = nextView === 'month' ? monthStart(today) : thisWeek;
    if (target !== home) next.week = target;
    if (nextView !== 'list') next.view = nextView;
    setParams(next);
  };

  const shifts = useQuery({
    queryKey: ['shifts', from, days],
    queryFn: ({ signal }) => listShifts(from, signal, days),
  });

  if (isManager) {
    const nav = <WeekNav from={from} thisWeek={thisWeek} onGo={goTo} />;
    return <ManagerRoster from={from} today={today} shifts={shifts} nav={nav} onGo={goTo} />;
  }
  return (
    <MyShifts
      orgName={me?.org.name ?? 'your café'}
      shifts={shifts}
      view={view}
      anchor={anchor}
      today={today}
      onGo={goTo}
    />
  );
}

type RosterView = 'list' | 'week' | 'month';

const VIEWS: { id: RosterView; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

/** Staff navigation: view toggle plus previous / today / next for the week or month shown. */
function CalendarNav({
  view,
  anchor,
  today,
  onGo,
}: {
  view: RosterView;
  anchor: string;
  today: string;
  onGo: (date: string, view?: RosterView) => void;
}) {
  const month = view === 'month';
  const unit = month ? 'month' : 'week';
  const step = (n: number) => (month ? addMonths(anchor, n) : addDays(anchor, 7 * n));
  const atToday = month ? isSameMonth(anchor, today) : mondayOf(anchor) === mondayOf(today);
  return (
    <div className="toolbar week-nav">
      <div className="view-toggle" role="group" aria-label="Roster view">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            className={view === v.id ? 'is-active' : undefined}
            onClick={() => onGo(anchor, v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => onGo(step(-1))} aria-label={`Previous ${unit}`}>
        ← <span className="week-nav__word">Previous</span>
      </button>
      <button type="button" onClick={() => onGo(today)} disabled={atToday}>
        {month ? 'This month' : 'This week'}
      </button>
      <button type="button" onClick={() => onGo(step(1))} aria-label={`Next ${unit}`}>
        <span className="week-nav__word">Next</span> →
      </button>
      <h2 className="week-nav__label" aria-live="polite">
        {month ? monthLabel(anchor) : weekLabel(mondayOf(anchor))}
      </h2>
    </div>
  );
}

type ShiftsQuery = UseQueryResult<ShiftsPayload>;

function WeekNav({
  from,
  thisWeek,
  onGo,
}: {
  from: string;
  thisWeek: string;
  onGo: (monday: string) => void;
}) {
  return (
    <div className="toolbar week-nav">
      <button type="button" onClick={() => onGo(addDays(from, -7))} aria-label="Previous week">
        ← <span className="week-nav__word">Previous</span>
      </button>
      <button type="button" onClick={() => onGo(thisWeek)} disabled={from === thisWeek}>
        This week
      </button>
      <button type="button" onClick={() => onGo(addDays(from, 7))} aria-label="Next week">
        <span className="week-nav__word">Next</span> →
      </button>
      <h2 className="week-nav__label" aria-live="polite">
        {weekLabel(from)}
      </h2>
    </div>
  );
}

function LoadState({ shifts }: { shifts: ShiftsQuery }) {
  if (shifts.isPending) return <p className="muted">Loading shifts…</p>;
  if (shifts.isError) {
    return (
      <div className="banner banner--error" role="alert">
        Couldn’t load shifts: {shifts.error.message}{' '}
        <button type="button" onClick={() => shifts.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  return null;
}

// ─── Staff: their own shifts ────────────────────────────────────────────────

function ShiftDetail({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  return (
    <div className="card cal-detail" role="region" aria-label="Shift details">
      <div>
        <p className="cell-strong">{dayHeading(shift.date)}</p>
        <p>
          {shift.start}–{shift.end} · {formatHours(shift.hours)} · {shift.position}
        </p>
        {shift.note && <p className="muted">{shift.note}</p>}
      </div>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

function MyShifts({
  orgName,
  shifts,
  view,
  anchor,
  today,
  onGo,
}: {
  orgName: string;
  shifts: ShiftsQuery;
  view: RosterView;
  anchor: string;
  today: string;
  onGo: (date: string, view?: RosterView) => void;
}) {
  const data = shifts.data;
  const [selected, setSelected] = useState<Shift | null>(null);
  const select = (s: Shift) => setSelected((cur) => (cur?.id === s.id ? null : s));
  const range = view === 'month' ? 'this month' : 'this week';
  return (
    <>
      <h1>My shifts</h1>
      <p className="lede">
        When you work at {orgName}, in café time. If something needs to change, ask your manager.
      </p>
      <CalendarNav view={view} anchor={anchor} today={today} onGo={onGo} />
      <LoadState shifts={shifts} />
      {data && (
        <>
          <StatLine
            className="my-shifts__stats"
            stats={[
              { label: 'Shifts', value: data.totals.shifts },
              { label: 'Hours', value: formatHours(data.totals.hours) },
            ]}
          />
          {view === 'week' && (
            <CalendarWeek
              monday={mondayOf(anchor)}
              today={today}
              shifts={data.shifts}
              selectedId={selected?.id ?? null}
              onSelect={select}
            />
          )}
          {view === 'month' && (
            <CalendarMonth
              month={anchor}
              today={today}
              shifts={data.shifts}
              selectedId={selected?.id ?? null}
              onSelect={select}
              onOpenWeek={(date) => {
                setSelected(null);
                onGo(date, 'week');
              }}
            />
          )}
          {view !== 'list' && selected && (
            <ShiftDetail shift={selected} onClose={() => setSelected(null)} />
          )}
          {view !== 'list' ? null : data.shifts.length === 0 ? (
            <div className="card empty">
              <p className="empty__title">No shifts {range}</p>
              <p className="muted">Your manager hasn’t put you on the roster for these days.</p>
            </div>
          ) : (
            <div className="card table-wrap">
              <table className="table">
                <caption className="visually-hidden">Your shifts</caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Time</th>
                    <th scope="col">Position</th>
                    <th scope="col" className="num">
                      Hours
                    </th>
                    <th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {data.shifts.map((s) => (
                    <tr key={s.id}>
                      <td className="cell-strong">{dayHeading(s.date)}</td>
                      <td data-label="Time">
                        {s.start}–{s.end}
                      </td>
                      <td data-label="Position">{s.position}</td>
                      <td className="num" data-label="Hours">
                        {formatHours(s.hours)}
                      </td>
                      <td data-label="Note">{s.note ?? <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ─── Managers: plan the week ────────────────────────────────────────────────

type Panel = { mode: 'closed' } | { mode: 'create'; date: string } | { mode: 'edit'; shift: Shift };

const describe = (s: { date: string; start: string; end: string }) =>
  `${dayHeading(s.date)} ${s.start}–${s.end}`;

function ManagerRoster({
  from,
  today,
  shifts,
  nav,
  onGo,
}: {
  from: string;
  today: string;
  shifts: ShiftsQuery;
  nav: ReactNode;
  onGo: (monday: string) => void;
}) {
  const queryClient = useQueryClient();
  const team = useQuery({ queryKey: ['team'], queryFn: ({ signal }) => listTeam(signal) });
  const [panel, setPanel] = useState<Panel>({ mode: 'closed' });
  const [notice, setNotice] = useState<{ kind: NoticeKind; body: ReactNode } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['shifts'] });
  const done = async (text: string) => {
    await refresh();
    setPanel({ mode: 'closed' });
    setNotice({ kind: 'success', body: text });
  };
  const who = (s: Shift) => s.assignee?.name ?? 'Open shift';

  const create = useMutation({
    mutationFn: createShift,
    onSuccess: (s) => done(`Added ${who(s)}: ${describe(s)}, ${s.position}.`),
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ShiftInput }) => updateShift(id, input),
    onSuccess: (s) => done(`Saved ${who(s)}: ${describe(s)}, ${s.position}.`),
  });
  const remove = useMutation({
    mutationFn: (s: Shift) => deleteShift(s.id),
    onSuccess: (_v, s) => done(`Deleted ${who(s)}: ${describe(s)}.`),
  });
  const copy = useMutation({
    mutationFn: () => copyWeek(from),
    onSuccess: async (r) => {
      await refresh();
      setNotice({
        kind: r.skipped.length ? 'info' : 'success',
        body: (
          <>
            <p className="notice__line">
              Copied {r.copied} shift{r.copied === 1 ? '' : 's'} to the week of {weekLabel(r.to)}.
              {r.opened > 0 &&
                ` ${r.opened} became open shift${r.opened === 1 ? '' : 's'} (people no longer on the roster).`}{' '}
              <button
                type="button"
                className="link-button link-button--inline"
                onClick={() => onGo(r.to)}
              >
                Show that week
              </button>
            </p>
            {r.skipped.length > 0 && (
              <>
                <p className="notice__line">Not copied:</p>
                <ul className="notice__list">
                  {r.skipped.map((s) => (
                    <li key={`${s.date}-${s.start}-${s.name}`}>
                      {s.name}, {describe(s)}: {s.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ),
      });
    },
    onError: (err) =>
      setNotice({
        kind: 'error',
        body: `Couldn’t copy the week: ${err instanceof ApiError ? err.message : 'unexpected error'}`,
      }),
  });

  const open = (next: Panel) => {
    setNotice(null);
    setPanel(next);
  };

  const data = shifts.data;
  const members = team.data ?? [];
  const positions = [
    ...new Set([...COMMON_POSITIONS, ...(data?.shifts.map((s) => s.position) ?? [])]),
  ];
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Roster</h1>
          <p className="lede">
            Who works when, in which position. Staff see their own shifts under My shifts.
          </p>
        </div>
        {panel.mode === 'closed' && (
          <button
            type="button"
            className="button--primary"
            onClick={() =>
              open({ mode: 'create', date: from <= today && today <= days[6]! ? today : from })
            }
          >
            + Add shift
          </button>
        )}
      </div>

      <div aria-live="polite">
        {notice && (
          <Notice kind={notice.kind} onDismiss={() => setNotice(null)}>
            {notice.body}
          </Notice>
        )}
      </div>

      {panel.mode !== 'closed' && (
        <ShiftForm
          key={panel.mode === 'edit' ? panel.shift.id : `new-${panel.date}`}
          shift={panel.mode === 'edit' ? panel.shift : undefined}
          date={panel.mode === 'create' ? panel.date : panel.shift.date}
          team={members}
          positions={positions}
          onSubmit={(input) =>
            panel.mode === 'edit'
              ? update.mutateAsync({ id: panel.shift.id, input })
              : create.mutateAsync(input)
          }
          onDelete={panel.mode === 'edit' ? () => remove.mutateAsync(panel.shift) : undefined}
          onCancel={() => setPanel({ mode: 'closed' })}
        />
      )}

      {nav}
      <LoadState shifts={shifts} />

      {data && (
        <>
          <div className="roster__summary">
            <StatLine
              className="roster__stats"
              stats={[
                { label: 'Shifts', value: data.totals.shifts },
                { label: 'Hours', value: formatHours(data.totals.hours) },
                { label: 'Open shifts', value: data.totals.open },
              ]}
            />
            <button
              type="button"
              onClick={() => copy.mutate()}
              disabled={copy.isPending || data.totals.shifts === 0}
            >
              {copy.isPending ? 'Copying…' : 'Copy to next week'}
            </button>
          </div>

          <div className="roster" aria-label={`Roster for ${weekLabel(from)}`}>
            {days.map((date) => {
              const onDay = data.shifts.filter((s) => s.date === date);
              const heading = dayHeading(date);
              return (
                <section
                  key={date}
                  className={`roster__day${date === today ? ' roster__day--today' : ''}`}
                  aria-label={heading}
                >
                  <h3 className="roster__date">
                    {heading}
                    {date === today && <span className="roster__today">Today</span>}
                  </h3>
                  {onDay.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`shift${s.assignee ? '' : ' shift--open'}`}
                      aria-label={`Edit shift: ${describe(s)}, ${s.position}, ${who(s)}`}
                      onClick={() => open({ mode: 'edit', shift: s })}
                    >
                      <span className="shift__time">
                        {s.start}–{s.end}
                      </span>
                      <span className="shift__who">{who(s)}</span>
                      <span className="shift__position">{s.position}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="roster__add"
                    aria-label={`Add shift on ${heading}`}
                    onClick={() => open({ mode: 'create', date })}
                  >
                    + Add
                  </button>
                </section>
              );
            })}
          </div>

          <HoursTable data={data} />
        </>
      )}

      {team.isError && (
        <div className="banner banner--error" role="alert">
          Couldn’t load the team: {team.error.message}
        </div>
      )}
      {team.data && (
        <TeamPanel
          team={team.data}
          onChanged={(text) => setNotice({ kind: 'success', body: text })}
        />
      )}
    </>
  );
}

function HoursTable({ data }: { data: ShiftsPayload }) {
  if (data.people.length === 0) return null;
  const limit = data.weeklyHoursLimit;
  return (
    <div className="card table-wrap roster__hours">
      <table className="table">
        <caption className="table__caption">Hours this week</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col" className="num">
              Shifts
            </th>
            <th scope="col" className="num">
              Hours
            </th>
          </tr>
        </thead>
        <tbody>
          {data.people.map((p) => (
            <tr key={p.userId}>
              <td className="cell-name">
                <span className="cell-strong">{p.name}</span>
                {(!p.onRoster || p.hours > limit) && (
                  <span className="cell-badges">
                    {!p.onRoster && <span className="badge badge--pending">Left the team</span>}
                    {p.hours > limit && (
                      <span
                        className="badge badge--low"
                        title={`More than ${limit} hours in a week`}
                      >
                        Over {limit} h
                      </span>
                    )}
                  </span>
                )}
              </td>
              <td className="num" data-label="Shifts">
                {p.shifts}
              </td>
              <td className="num" data-label="Hours">
                {formatHours(p.hours)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
