import type { CSSProperties } from 'react';
import type { Shift } from '../api';
import { addDays, dayHeading, minutesOf, weekdayShort } from './dates';

const HOUR_PX = 48;

interface Placed {
  shift: Shift;
  lane: number;
  lanes: number;
}

/** Side-by-side lanes for shifts that overlap in time on one day. */
function layout(shifts: Shift[]): Placed[] {
  const sorted = [...shifts].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  const placed: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  const laneEnds: number[] = [];
  const flush = () => {
    for (const p of group) p.lanes = laneEnds.length;
    placed.push(...group);
    group = [];
    laneEnds.length = 0;
  };
  for (const shift of sorted) {
    const start = minutesOf(shift.start);
    if (group.length > 0 && start >= groupEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = minutesOf(shift.end);
    groupEnd = Math.max(groupEnd, minutesOf(shift.end));
    group.push({ shift, lane, lanes: 1 });
  }
  flush();
  return placed;
}

const hourLabel = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

/** Google-Calendar-style week: a column per day, shifts placed by clock time. */
export function CalendarWeek({
  monday,
  today,
  shifts,
  selectedId,
  onSelect,
}: {
  monday: string;
  today: string;
  shifts: Shift[];
  selectedId: string | null;
  onSelect: (shift: Shift) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const startHour = Math.min(8, ...shifts.map((s) => Math.floor(minutesOf(s.start) / 60)));
  const endHour = Math.max(20, ...shifts.map((s) => Math.ceil(minutesOf(s.end) / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const height = (endHour - startHour) * HOUR_PX;

  return (
    <div className="card cal-week" role="group" aria-label="Week calendar">
      <div className="cal-week__scroll">
        <div className="cal-week__head">
          <div className="cal-week__gutter" />
          {days.map((d) => (
            <div key={d} className={`cal-week__dayhead${d === today ? ' is-today' : ''}`}>
              <span className="cal-week__dow">{weekdayShort(d)}</span>
              <span className="cal-week__dom">{Number(d.slice(8))}</span>
            </div>
          ))}
        </div>
        <div className="cal-week__body" style={{ height }}>
          <div className="cal-week__gutter" aria-hidden="true">
            {hours.map((h) => (
              <div key={h} className="cal-week__hour" style={{ height: HOUR_PX }}>
                {hourLabel(h)}
              </div>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className={`cal-week__col${d === today ? ' is-today' : ''}`}>
              {hours.map((h) => (
                <div key={h} className="cal-week__cell" style={{ height: HOUR_PX }} />
              ))}
              {layout(shifts.filter((s) => s.date === d)).map(({ shift, lane, lanes }) => {
                const top = ((minutesOf(shift.start) - startHour * 60) / 60) * HOUR_PX;
                const h = ((minutesOf(shift.end) - minutesOf(shift.start)) / 60) * HOUR_PX;
                const style: CSSProperties = {
                  top,
                  height: Math.max(h, 20),
                  left: `calc(${(lane / lanes) * 100}% + 2px)`,
                  width: `calc(${100 / lanes}% - 4px)`,
                };
                return (
                  <button
                    key={shift.id}
                    type="button"
                    className={`cal-event${selectedId === shift.id ? ' is-selected' : ''}`}
                    style={style}
                    aria-pressed={selectedId === shift.id}
                    aria-label={`${dayHeading(shift.date)}, ${shift.start}–${shift.end}, ${shift.position}`}
                    onClick={() => onSelect(shift)}
                  >
                    <span className="cal-event__time">
                      {shift.start}–{shift.end}
                    </span>
                    <span className="cal-event__title">{shift.position}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
