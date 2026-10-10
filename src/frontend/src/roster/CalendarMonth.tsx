import type { Shift } from '../api';
import { addDays, dayHeading, isSameMonth, monthGridStart } from './dates';

const MAX_CHIPS = 3;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Month grid (Monday first). Days with more than three shifts collapse to "+N more". */
export function CalendarMonth({
  month,
  today,
  shifts,
  selectedId,
  onSelect,
  onOpenWeek,
}: {
  month: string;
  today: string;
  shifts: Shift[];
  selectedId: string | null;
  onSelect: (shift: Shift) => void;
  onOpenWeek: (date: string) => void;
}) {
  const start = monthGridStart(month);
  const weeks = Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)),
  );

  return (
    <div className="card cal-month" role="group" aria-label="Month calendar">
      <div className="cal-month__dows" aria-hidden="true">
        {DOW.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} className="cal-month__week">
          {week.map((date) => {
            const day = shifts.filter((s) => s.date === date);
            const classes = [
              'cal-month__day',
              isSameMonth(date, month) ? '' : 'is-outside',
              date === today ? 'is-today' : '',
            ];
            return (
              <div key={date} className={classes.filter(Boolean).join(' ')}>
                <button
                  type="button"
                  className="cal-month__num"
                  aria-label={`Open week of ${dayHeading(date)}`}
                  onClick={() => onOpenWeek(date)}
                >
                  {Number(date.slice(8))}
                </button>
                {day.slice(0, MAX_CHIPS).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`cal-chip${selectedId === s.id ? ' is-selected' : ''}`}
                    aria-pressed={selectedId === s.id}
                    aria-label={`${dayHeading(s.date)}, ${s.start}–${s.end}, ${s.position}`}
                    onClick={() => onSelect(s)}
                  >
                    <span className="cal-chip__time">{s.start}</span> {s.position}
                  </button>
                ))}
                {day.length > MAX_CHIPS && (
                  <button
                    type="button"
                    className="cal-month__more"
                    onClick={() => onOpenWeek(date)}
                  >
                    +{day.length - MAX_CHIPS} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
