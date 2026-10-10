import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
  getLatestForecast,
  type ForecastPayload,
  type ForecastRunSummary,
  type ItemForecast,
} from '../api';
import { useAuth } from '../auth/context';
import { Notice } from '../components/Notice';
import { StatLine } from '../components/StatLine';
import { formatDateTime, formatLongDate, formatQty, formatWeekday } from '../format';
import { Breakdown } from './Breakdown';
import { ForecastChart, Sparkline } from './ForecastChart';
import { describeModel, STATUS_HELP, STATUS_TEXT } from './labels';

const r1 = (n: number) => Math.round(n * 10) / 10;
const mase = (v: number | null) => (v === null ? '—' : v.toFixed(2));
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Manager-only: what to reorder, and why — from the latest forecast run. */
export function ForecastPage() {
  const { me } = useAuth();
  const isManager = me?.user.role === 'MANAGER';
  const latest = useQuery({
    queryKey: ['forecast', 'latest'],
    queryFn: ({ signal }) => getLatestForecast(signal),
    enabled: isManager,
  });

  if (!isManager) {
    return (
      <>
        <h1>Forecast</h1>
        <p className="banner banner--error" role="alert">
          Only managers can see the forecast.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Forecast</h1>
      <p className="lede">
        What to reorder, and why — worked out from each item’s demand history, stock on hand and
        supplier lead time.
      </p>
      {latest.isPending && <p className="muted">Loading the forecast…</p>}
      {latest.isError && (
        <p className="banner banner--error" role="alert">
          Couldn’t load the forecast: {latest.error.message}
        </p>
      )}
      {latest.isSuccess && !latest.data.run && (
        <div className="card empty">
          <p className="empty__title">No forecast has run yet</p>
          <p className="muted">
            Run <code>npm run forecast:publish</code> in the terminal (from Task 10 it runs every
            night), then refresh this page.
          </p>
        </div>
      )}
      {latest.isSuccess && latest.data.run && <Forecast data={latest.data} run={latest.data.run} />}
    </>
  );
}

function Forecast({ data, run }: { data: ForecastPayload; run: ForecastRunSummary }) {
  const items = data.items ?? [];
  const [params, setParams] = useSearchParams();
  const selected = items.find((i) => i.item.id === params.get('item')) ?? items[0];
  const select = (id: string) => setParams(new URLSearchParams({ item: id }), { replace: true });
  const [staleNoteClosed, setStaleNoteClosed] = useState(false);

  const historyTo = addDays(run.forecastFrom, -1);
  // How far the forecast's first day lags behind when it was run (real-dated imported history)
  const staleDays = Math.round(
    (new Date(run.finishedAt ?? run.startedAt).getTime() -
      new Date(`${run.forecastFrom}T00:00:00`).getTime()) /
      86_400_000,
  );

  return (
    <>
      <StatLine
        className="forecast__run"
        stats={[
          {
            label: 'Forecast from',
            value: `${formatWeekday(run.forecastFrom)} ${formatLongDate(run.forecastFrom)}`,
          },
          { label: 'History up to', value: formatLongDate(historyTo) },
          { label: 'Updated', value: formatDateTime(run.finishedAt ?? run.startedAt) },
        ]}
      />
      {staleDays > 7 && !staleNoteClosed && (
        <Notice kind="info" onDismiss={() => setStaleNoteClosed(true)}>
          This forecast starts on {formatLongDate(run.forecastFrom)} because the demand history ends
          the day before — the imported dataset keeps its real dates. Once the café records new
          usage (or the nightly forecast runs on current data), it moves to today.
        </Notice>
      )}

      <Kpis run={run} summary={data.summary} />

      {items.length === 0 ? (
        <div className="card empty">
          <p className="empty__title">This run has no items</p>
          <p className="muted">Add items and their stock, then run the forecast again.</p>
        </div>
      ) : (
        <>
          <ItemsTable items={items} selectedId={selected?.item.id} onSelect={select} />
          {selected && (
            <div className="forecast__detail">
              <section className="card history-chart" aria-labelledby="forecast-chart-title">
                <h2 id="forecast-chart-title" className="usage__title">
                  {selected.item.name} — actual and forecast demand
                </h2>
                <StatLine
                  className="usage__totals"
                  stats={[
                    {
                      label: 'Next 7 days',
                      value: formatQty(
                        r1(selected.forecast.reduce((s, f) => s + f.predicted, 0)),
                        selected.item.unit,
                      ),
                    },
                    {
                      label: 'On hand',
                      value: formatQty(selected.recommendation.onHand, selected.item.unit),
                    },
                    { label: 'Status', value: STATUS_TEXT[selected.recommendation.status] },
                  ]}
                />
                <ForecastChart data={selected} />
              </section>
              <Breakdown data={selected} run={run} />
            </div>
          )}
        </>
      )}
    </>
  );
}

function Kpis({ run, summary }: { run: ForecastRunSummary; summary: ForecastPayload['summary'] }) {
  const toOrder = (summary?.urgent ?? 0) + (summary?.reorder ?? 0);
  const usedMase = run.modelKind === 'ML' ? run.maseModel : run.maseBaseline;
  const baselineName = describeModel(run.baselineTag).replace(/ \(.*\)$/, '');
  const comparison =
    run.modelKind === 'ML'
      ? `Chosen: lower error than the ${baselineName.toLowerCase()}`
      : run.isFallback
        ? 'The ML model couldn’t be used, so the baseline ran'
        : run.maseModel !== null
          ? 'Chosen: lower error than the LightGBM model'
          : 'Baseline forecast';

  return (
    <div className="kpis">
      <section className="card kpi" aria-labelledby="kpi-order">
        <h2 id="kpi-order" className="kpi__label">
          Items to order
        </h2>
        <p className="kpi__value">{toOrder}</p>
        <StatLine
          className="kpi__sub"
          stats={[
            { label: 'Urgent', value: summary?.urgent ?? 0 },
            { label: 'Reorder', value: summary?.reorder ?? 0 },
            { label: 'OK', value: summary?.ok ?? 0 },
          ]}
        />
      </section>
      <section className="card kpi" aria-labelledby="kpi-error">
        <h2 id="kpi-error" className="kpi__label">
          Forecast error (MASE)
        </h2>
        <p className="kpi__value">{mase(usedMase)}</p>
        <StatLine
          className="kpi__sub"
          stats={[
            { label: 'LightGBM', value: mase(run.maseModel) },
            { label: baselineName, value: mase(run.maseBaseline) },
          ]}
        />
        <p className="kpi__hint">
          Last {run.evalWeeks} weeks. Lower is better; below 1.00 beats “same day last week”.
        </p>
      </section>
      <section className="card kpi" aria-labelledby="kpi-model">
        <h2 id="kpi-model" className="kpi__label">
          Forecast by
        </h2>
        <p className="kpi__value kpi__value--text">{describeModel(run.modelTag)}</p>
        <p className="kpi__hint">
          {comparison}
          {run.isFallback && <span className="badge badge--low"> Fallback</span>}
        </p>
      </section>
    </div>
  );
}

function ItemsTable({
  items,
  selectedId,
  onSelect,
}: {
  items: ItemForecast[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="card table-wrap">
      <table className="table">
        <caption className="table__caption">
          Recommendations for {items.length} item{items.length === 1 ? '' : 's'}, most urgent first.
          Pick one to see its chart and how the number was worked out.
        </caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">
              On hand
            </th>
            <th scope="col" className="num">
              Cover
            </th>
            <th scope="col">Trend</th>
            <th scope="col" className="num">
              Order
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const r = i.recommendation;
            const isSelected = i.item.id === selectedId;
            const past =
              i.history.reduce((s, h) => s + h.quantity, 0) / Math.max(i.history.length, 1);
            const next =
              i.forecast.reduce((s, f) => s + f.predicted, 0) / Math.max(i.forecast.length, 1);
            return (
              <tr key={i.item.id} className={isSelected ? 'is-selected' : undefined}>
                <td className="cell-name">
                  <button
                    type="button"
                    className="link-button link-button--name cell-strong"
                    aria-pressed={isSelected}
                    onClick={() => onSelect(i.item.id)}
                  >
                    {i.item.name}
                  </button>
                  <span className="cell-sub">{i.item.category}</span>
                </td>
                <td data-label="Status">
                  <span
                    className={`status status--${r.status.toLowerCase()}`}
                    title={STATUS_HELP[r.status]}
                  >
                    {STATUS_TEXT[r.status]}
                  </span>
                </td>
                <td className="num" data-label="On hand">
                  {formatQty(r.onHand, i.item.unit)}
                </td>
                <td className="num" data-label="Cover">
                  {r.coverDays === null ? '—' : `${r1(r.coverDays)} days`}
                </td>
                <td data-label="Trend">
                  <Sparkline data={i} />
                  <span className="visually-hidden">
                    Average {formatQty(r1(past), i.item.unit)} a day over the last 4 weeks; forecast{' '}
                    {formatQty(r1(next), i.item.unit)} a day
                  </span>
                </td>
                <td className="num" data-label="Order">
                  {r.recommendedQty > 0 ? (
                    <strong>{formatQty(r1(r.recommendedQty), i.item.unit)}</strong>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
