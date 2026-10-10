import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { ItemForecast } from '../api';
import { StatLine } from '../components/StatLine';
import { useWidth } from '../components/useWidth';
import { formatDay, formatLongDate, formatQty, formatWeekday } from '../format';
import { niceMax } from '../stock/chart-data';

const MARGIN = { top: 22, right: 12, bottom: 26, left: 52 };

interface Point {
  date: string;
  actual: number | null;
  predicted: number | null;
  lower: number | null;
  upper: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The last 4 weeks of actual demand (bars) followed by the forecast (line) with its likely
 * range (shaded). Hover, tap or use the arrow keys to read a day; the same numbers are in a
 * table underneath.
 */
export function ForecastChart({ data }: { data: ItemForecast }) {
  const { item, history, forecast } = data;
  const unit = item.unit;
  const points: Point[] = [
    ...history.map((h) => ({
      date: h.date,
      actual: h.quantity,
      predicted: null,
      lower: null,
      upper: null,
    })),
    ...forecast.map((f) => ({
      date: f.date,
      actual: null,
      predicted: f.predicted,
      lower: f.lower,
      upper: f.upper,
    })),
  ];
  const n = points.length;
  const firstForecast = history.length;

  const [wrapRef, width] = useWidth<HTMLDivElement>(720);
  const height = width < 480 ? 200 : 240;
  const [active, setActive] = useState<number | null>(null);
  const shown = active ?? firstForecast;

  const plotW = Math.max(width - MARGIN.left - MARGIN.right, 10);
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const peak = Math.max(
    0,
    ...points.map((p) => Math.max(p.actual ?? 0, p.upper ?? 0, p.predicted ?? 0)),
  );
  const yMax = niceMax(peak);
  const step = plotW / Math.max(n, 1);
  const x = (i: number) => MARGIN.left + (i + 0.5) * step;
  const y = (v: number) => MARGIN.top + plotH - (v / yMax) * plotH;
  const barW = Math.max(step - 2, 1);

  const fc = points.slice(firstForecast);
  const line = fc
    .map(
      (p, i) => `${i ? 'L' : 'M'}${x(firstForecast + i).toFixed(1)},${y(p.predicted!).toFixed(1)}`,
    )
    .join('');
  const band =
    fc.length && fc.every((p) => p.lower !== null && p.upper !== null)
      ? [
          ...fc.map(
            (p, i) =>
              `${i ? 'L' : 'M'}${x(firstForecast + i).toFixed(1)},${y(p.upper!).toFixed(1)}`,
          ),
          ...fc
            .map((p, i) => `L${x(firstForecast + i).toFixed(1)},${y(p.lower!).toFixed(1)}`)
            .reverse(),
          'Z',
        ].join('')
      : null;
  const boundary = MARGIN.left + firstForecast * step;
  const narrow = width - MARGIN.right - boundary < 80;
  const ticks = points.map((_, i) => i).filter((i) => (i - firstForecast) % 7 === 0);

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - box.left - MARGIN.left) / step);
    setActive(Math.min(Math.max(i, 0), n - 1));
  };
  const keys = (e: KeyboardEvent<SVGSVGElement>) => {
    const move = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : n - 1);
    } else if (move) {
      e.preventDefault();
      setActive(Math.min(Math.max(shown + move, 0), n - 1));
    }
  };

  const p = points[shown]!;
  const actualTotal = history.reduce((s, h) => s + h.quantity, 0);
  const forecastTotal = forecast.reduce((s, f) => s + f.predicted, 0);
  const summary =
    `${item.name}: actual demand over the ${history.length} days to ${formatLongDate(history.at(-1)?.date ?? p.date)} ` +
    `averaged ${formatQty(round1(actualTotal / Math.max(history.length, 1)), unit)} a day; ` +
    `the forecast for the next ${forecast.length} days totals ${formatQty(round1(forecastTotal), unit)}.`;

  return (
    <figure className="chart forecast-chart">
      <div className="chart__readout" aria-live="polite">
        <StatLine
          stats={[
            { label: 'Day', value: `${formatWeekday(p.date)} ${formatLongDate(p.date)}` },
            p.actual !== null
              ? { label: 'Actual', value: <strong>{formatQty(p.actual, unit)}</strong> }
              : {
                  label: 'Forecast',
                  value: <strong>{formatQty(round1(p.predicted!), unit)}</strong>,
                },
            ...(p.lower !== null && p.upper !== null
              ? [
                  {
                    label: 'Likely range',
                    value: `${formatQty(round1(p.lower), unit)} – ${formatQty(round1(p.upper), unit)}`,
                  },
                ]
              : []),
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
          <rect
            className="forecast-chart__future"
            x={boundary}
            y={MARGIN.top}
            width={width - MARGIN.right - boundary}
            height={plotH}
          />
          {/* on a phone the forecast area is too narrow for "Forecast →": centre a shorter label */}
          {narrow ? (
            <text
              className="chart__label"
              x={(boundary + width - MARGIN.right) / 2}
              y={MARGIN.top - 8}
              textAnchor="middle"
            >
              Forecast
            </text>
          ) : (
            <text className="chart__label" x={boundary + 6} y={MARGIN.top - 8}>
              Forecast →
            </text>
          )}
          <text className="chart__label" x={boundary - 6} y={MARGIN.top - 8} textAnchor="end">
            ← Actual
          </text>
          {points
            .slice(0, firstForecast)
            .map((pt, i) =>
              pt.actual! > 0 ? (
                <rect
                  key={pt.date}
                  className={`chart__bar${i === shown ? ' is-active' : ''}`}
                  x={x(i) - barW / 2}
                  y={y(pt.actual!)}
                  width={barW}
                  height={y(0) - y(pt.actual!)}
                />
              ) : null,
            )}
          {band && <path className="forecast-chart__band" d={band} />}
          <path className="chart__avg" d={line} />
          {fc.map((pt, i) => (
            <circle
              key={pt.date}
              className="forecast-chart__dot"
              cx={x(firstForecast + i)}
              cy={y(pt.predicted!)}
              r={4}
            />
          ))}
          <line className="chart__cursor" x1={x(shown)} x2={x(shown)} y1={MARGIN.top} y2={y(0)} />
          {ticks.map((i) => (
            <text key={i} className="chart__label" x={x(i)} y={height - 8} textAnchor="middle">
              {formatDay(points[i]!.date)}
            </text>
          ))}
        </svg>
      </div>
      <figcaption className="chart__legend">
        <span className="chart__legend-item">
          <span className="chart__key chart__key--bar" aria-hidden="true" /> Actual demand
        </span>
        <span className="chart__legend-item">
          <span className="chart__key chart__key--avg" aria-hidden="true" /> Forecast
        </span>
        <span className="chart__legend-item">
          <span className="chart__key chart__key--band" aria-hidden="true" /> Likely range
        </span>
        <span className="muted chart__hint">Hover, tap or use ← → to read a day</span>
      </figcaption>
      <details className="chart__table">
        <summary>Show as a table</summary>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col" className="num">
                  Actual
                </th>
                <th scope="col" className="num">
                  Forecast
                </th>
                <th scope="col" className="num">
                  Likely range
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((pt) => (
                <tr key={pt.date}>
                  <td data-label="Day">
                    {formatWeekday(pt.date)} {formatLongDate(pt.date)}
                  </td>
                  <td className="num" data-label="Actual">
                    {pt.actual === null ? '—' : formatQty(pt.actual, unit)}
                  </td>
                  <td className="num" data-label="Forecast">
                    {pt.predicted === null ? '—' : formatQty(round1(pt.predicted), unit)}
                  </td>
                  <td className="num" data-label="Likely range">
                    {pt.lower === null || pt.upper === null
                      ? '—'
                      : `${formatQty(round1(pt.lower))} – ${formatQty(round1(pt.upper), unit)}`}
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

/** A tiny trend line: the last 4 weeks (grey) running into the forecast (accent). Decorative;
 *  the row's text says the same in words. */
export function Sparkline({ data }: { data: ItemForecast }) {
  const values = [...data.history.map((h) => h.quantity), ...data.forecast.map((f) => f.predicted)];
  const w = 120;
  const h = 32;
  const max = Math.max(1, ...values);
  const x = (i: number) => (i / Math.max(values.length - 1, 1)) * (w - 4) + 2;
  const y = (v: number) => h - 3 - (v / max) * (h - 6);
  const split = data.history.length;
  const path = (from: number, to: number) =>
    values
      .slice(from, to)
      .map((v, i) => `${i ? 'L' : 'M'}${x(from + i).toFixed(1)},${y(v).toFixed(1)}`)
      .join('');
  return (
    <svg className="sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path className="sparkline__actual" d={path(0, split)} />
      <path className="sparkline__forecast" d={path(split - 1, values.length)} />
    </svg>
  );
}
