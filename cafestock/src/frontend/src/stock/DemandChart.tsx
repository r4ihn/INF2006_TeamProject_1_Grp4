import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useWidth } from '../components/useWidth';
import { formatLongDate, formatMonth, formatQty, formatWeekday } from '../format';
import { StatLine } from '../components/StatLine';
import { monthStarts, movingAverage, niceMax, weeklyTotals, type DayValue } from './chart-data';

interface Props {
  days: DayValue[];
  unit: string;
  /** Item name, for the accessible description */
  label: string;
}

const MARGIN = { top: 12, right: 12, bottom: 26, left: 52 };

/**
 * Daily demand as bars with a 7-day average line. Drawn at the container's real pixel width
 * so labels stay readable on a phone. Hover, tap or use the arrow keys to read any day; the
 * same numbers are available as a weekly table underneath.
 */
export function DemandChart({ days, unit, label }: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>(720);
  const height = width < 480 ? 180 : 220;
  const avg = useMemo(() => movingAverage(days), [days]);
  const [active, setActive] = useState<number | null>(null);
  const shown = active ?? days.length - 1;

  const plotW = Math.max(width - MARGIN.left - MARGIN.right, 10);
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const peak = Math.max(0, ...days.map((d) => d.quantity));
  const yMax = niceMax(peak);
  const n = days.length;
  const step = plotW / Math.max(n, 1);
  const x = (i: number) => MARGIN.left + (i + 0.5) * step;
  const y = (v: number) => MARGIN.top + plotH - (v / yMax) * plotH;
  const barW = Math.max(step - (step > 3 ? 1 : 0.25), 0.5);

  const avgPath = avg
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join('');
  const ticks = monthStarts(days, Math.max(2, Math.floor(plotW / 56)));
  const total = days.reduce((s, d) => s + d.quantity, 0);
  const busiest = days.reduce((b, d) => (d.quantity > b.quantity ? d : b), days[0]!);

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - box.left - MARGIN.left) / step);
    setActive(Math.min(Math.max(i, 0), n - 1));
  };
  const keys = (e: KeyboardEvent<SVGSVGElement>) => {
    const move = { ArrowLeft: -1, ArrowRight: 1, PageUp: -7, PageDown: 7 }[e.key];
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : n - 1);
    } else if (move) {
      e.preventDefault();
      setActive(Math.min(Math.max(shown + move, 0), n - 1));
    }
  };

  const day = days[shown]!;
  const summary =
    `Daily demand for ${label}, ${formatLongDate(days[0]!.date)} to ${formatLongDate(days[n - 1]!.date)}: ` +
    `${formatQty(Math.round(total), unit)} in total, ${formatQty(Math.round((total / n) * 10) / 10, unit)} a day on average, ` +
    `busiest ${formatLongDate(busiest.date)} with ${formatQty(busiest.quantity, unit)}.`;

  return (
    <figure className="chart">
      <div className="chart__readout" aria-live="polite">
        <StatLine
          stats={[
            { label: 'Day', value: `${formatWeekday(day.date)} ${formatLongDate(day.date)}` },
            { label: 'Demand', value: <strong>{formatQty(day.quantity, unit)}</strong> },
            { label: '7-day average', value: formatQty(Math.round(avg[shown]! * 10) / 10, unit) },
          ]}
        />
      </div>
      <div ref={wrapRef} className="chart__canvas">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={summary}
          tabIndex={0}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setActive(null)}
          onKeyDown={keys}
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line
                className="chart__grid"
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(yMax * f)}
                y2={y(yMax * f)}
              />
              <text
                className="chart__label"
                x={MARGIN.left - 6}
                y={y(yMax * f) + 4}
                textAnchor="end"
              >
                {formatQty(yMax * f)}
              </text>
            </g>
          ))}
          {days.map((d, i) =>
            d.quantity > 0 ? (
              <rect
                key={d.date}
                className={`chart__bar${i === shown ? ' is-active' : ''}`}
                x={x(i) - barW / 2}
                y={y(d.quantity)}
                width={barW}
                height={y(0) - y(d.quantity)}
              />
            ) : null,
          )}
          <path className="chart__avg" d={avgPath} />
          <line className="chart__cursor" x1={x(shown)} x2={x(shown)} y1={MARGIN.top} y2={y(0)} />
          {ticks.map((i) => (
            <text key={i} className="chart__label" x={x(i)} y={height - 8} textAnchor="middle">
              {formatMonth(days[i]!.date)}
              {days[i]!.date.slice(5, 7) === '01' || i === ticks[0]
                ? ` ’${days[i]!.date.slice(2, 4)}`
                : ''}
            </text>
          ))}
        </svg>
      </div>
      <figcaption className="chart__legend">
        <span className="chart__legend-item">
          <span className="chart__key chart__key--bar" aria-hidden="true" /> Each day
        </span>
        <span className="chart__legend-item">
          <span className="chart__key chart__key--avg" aria-hidden="true" /> 7-day average
        </span>
        <span className="muted chart__hint">Hover, tap or use ← → to read a day</span>
      </figcaption>
      <details className="chart__table">
        <summary>Show as a table (weekly totals)</summary>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Week starting</th>
                <th scope="col" className="num">
                  Total
                </th>
                <th scope="col" className="num">
                  Days
                </th>
              </tr>
            </thead>
            <tbody>
              {weeklyTotals(days).map((w) => (
                <tr key={w.weekStarting}>
                  <td data-label="Week starting">{formatLongDate(w.weekStarting)}</td>
                  <td className="num" data-label="Total">
                    {formatQty(w.total, unit)}
                  </td>
                  <td className="num" data-label="Days">
                    {w.days}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
