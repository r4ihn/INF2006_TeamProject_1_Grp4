import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDemand, getHistory, listImports, type DatasetImport, type ItemHistory } from '../api';
import { formatDateTime, formatLongDate, formatQty } from '../format';
import { StatLine } from '../components/StatLine';
import { DemandChart } from './DemandChart';
import { IMPORTS_KEY, STOCK_KEYS } from './labels';

const RANGES = [
  { id: '90', label: '90 days', days: 90 },
  { id: '365', label: '1 year', days: 365 },
  { id: 'all', label: 'All', days: 731 },
] as const;
type RangeId = (typeof RANGES)[number]['id'];

const MAX_DAYS = 731;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Days from a to b inclusive, for "YYYY-MM-DD" dates. */
const spanDays = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

interface Props {
  itemId: string;
  onItemChange: (itemId: string) => void;
}

/**
 * Everything the forecast will learn from: how much daily demand history each item has, a
 * chart of it, and where the data came from (the dataset import's provenance).
 */
export function History({ itemId, onItemChange }: Props) {
  const history = useQuery({
    queryKey: STOCK_KEYS.history,
    queryFn: ({ signal }) => getHistory(signal),
  });
  const imports = useQuery({ queryKey: IMPORTS_KEY, queryFn: ({ signal }) => listImports(signal) });
  const rows = history.data ?? [];
  // Until one is picked, show the item with the steadiest history (fewest days with none)
  const selected =
    rows.find((r) => r.itemId === itemId) ??
    [...rows].sort((a, b) => a.zeroDays / a.days - b.zeroDays / b.days)[0];

  return (
    <>
      <Provenance imports={imports.data} error={imports.error?.message} />

      {history.isPending && <p className="muted">Loading history…</p>}
      {history.isError && (
        <p className="banner banner--error" role="alert">
          Couldn’t load history: {history.error.message}
        </p>
      )}
      {history.isSuccess && rows.length === 0 && (
        <div className="card empty">
          <p className="empty__title">No demand history yet</p>
          <p className="muted">
            Import the café dataset (see above), or record usage — each day’s usage becomes history.
          </p>
        </div>
      )}
      {selected && (
        <>
          <ItemChart key={selected.itemId} item={selected} />
          <HistoryTable rows={rows} selectedId={selected.itemId} onSelect={onItemChange} />
        </>
      )}
    </>
  );
}

function Provenance({ imports, error }: { imports?: DatasetImport[]; error?: string }) {
  if (error) {
    return (
      <p className="banner banner--error" role="alert">
        Couldn’t load where the data came from: {error}
      </p>
    );
  }
  if (!imports) return null;
  const latest = imports[0];
  if (!latest) {
    return (
      <section className="card provenance" aria-labelledby="provenance-title">
        <h2 id="provenance-title" className="provenance__title">
          No dataset imported yet
        </h2>
        <p className="muted">
          To load the café’s sales history, run <code>npm run db:import</code> in the terminal, then
          refresh this page.
        </p>
      </section>
    );
  }
  const shifted = latest.dateShiftDays !== 0;
  return (
    <section className="card provenance" aria-labelledby="provenance-title">
      <h2 id="provenance-title" className="provenance__title">
        Where this data came from
      </h2>
      <p className="provenance__source">{latest.source}</p>
      <dl className="provenance__facts">
        <div>
          <dt>Dates</dt>
          <dd>
            {formatLongDate(latest.dateFrom)} – {formatLongDate(latest.dateTo)} (
            {latest.dayCount.toLocaleString('en')} days)
          </dd>
        </div>
        <div>
          <dt>Items</dt>
          <dd>{latest.itemCount}</dd>
        </div>
        <div>
          <dt>Imported</dt>
          <dd>{formatDateTime(latest.importedAt)}</dd>
        </div>
        {imports.length > 1 && (
          <div>
            <dt>Import runs</dt>
            <dd>{imports.length}</dd>
          </div>
        )}
      </dl>
      {shifted && (
        <p className="banner banner--info provenance__shift">
          Dates were moved forward {latest.dateShiftDays} days ({latest.dateShiftDays / 7} weeks) so
          the history ends recently; weekdays are unchanged.
        </p>
      )}
      <details className="provenance__files">
        <summary>Files and checksums</summary>
        <ul>
          {latest.files.map((f) => (
            <li key={f.file}>
              <code>{f.file}</code> — {f.rows.toLocaleString('en')} rows · SHA-256{' '}
              <code title={f.sha256}>{f.sha256.slice(0, 12)}…</code>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function ItemChart({ item }: { item: ItemHistory }) {
  const span = spanDays(item.firstDate, item.lastDate);
  const [range, setRange] = useState<RangeId>('all');
  const days = Math.min(RANGES.find((r) => r.id === range)!.days, span, MAX_DAYS);
  const name = useId();
  const demand = useQuery({
    queryKey: [...STOCK_KEYS.demand, item.itemId, days, item.lastDate],
    queryFn: ({ signal }) => getDemand(item.itemId, days, signal, item.lastDate),
  });

  return (
    <section className="card history-chart" aria-labelledby={`${name}-title`}>
      <div className="history-chart__header">
        <div>
          <h2 id={`${name}-title`} className="usage__title">
            {item.name} — daily demand
          </h2>
          <StatLine
            className="usage__totals"
            stats={[
              { label: 'Average a day', value: formatQty(round1(item.averagePerDay), item.unit) },
              { label: 'On hand now', value: formatQty(item.onHand, item.unit) },
            ]}
          />
        </div>
        <fieldset className="segmented segmented--small">
          <legend className="visually-hidden">Period</legend>
          {RANGES.filter((r) => r.id === 'all' || r.days < span).map((r) => (
            <label
              key={r.id}
              className={`segmented__option${range === r.id ? ' is-selected' : ''}`}
            >
              <input
                type="radio"
                name={name}
                value={r.id}
                checked={range === r.id}
                onChange={() => setRange(r.id)}
              />
              {r.label}
            </label>
          ))}
        </fieldset>
      </div>
      {demand.isPending && <p className="muted history-chart__loading">Loading chart…</p>}
      {demand.isError && (
        <p className="banner banner--error" role="alert">
          Couldn’t load the chart: {demand.error.message}
        </p>
      )}
      {demand.isSuccess && (
        <DemandChart days={demand.data.days} unit={demand.data.unit} label={item.name} />
      )}
    </section>
  );
}

const sourceLabel = (r: ItemHistory) =>
  r.importedDays && r.recordedDays ? 'Dataset + app' : r.importedDays ? 'Dataset' : 'App';

function HistoryTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: ItemHistory[];
  selectedId: string;
  onSelect: (itemId: string) => void;
}) {
  return (
    <div className="card table-wrap">
      <table className="table">
        <caption className="table__caption">
          History for {rows.length} item{rows.length === 1 ? '' : 's'}
        </caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="num">
              Days
            </th>
            <th scope="col">From – to</th>
            <th scope="col" className="num">
              Average a day
            </th>
            <th scope="col" className="num">
              Days with none
            </th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSelected = r.itemId === selectedId;
            return (
              <tr key={r.itemId} className={isSelected ? 'is-selected' : undefined}>
                <td className="cell-name">
                  <button
                    type="button"
                    className="link-button link-button--name cell-strong"
                    aria-pressed={isSelected}
                    onClick={() => onSelect(r.itemId)}
                  >
                    {r.name}
                  </button>
                  {!r.isActive && <span className="badge">Archived</span>}
                </td>
                <td className="num" data-label="Days">
                  {r.days.toLocaleString('en')}
                </td>
                <td data-label="From – to">
                  {formatLongDate(r.firstDate)} – {formatLongDate(r.lastDate)}
                </td>
                <td className="num" data-label="Average a day">
                  {formatQty(round1(r.averagePerDay), r.unit)}
                </td>
                <td className="num" data-label="Days with none">
                  <span>
                    {r.zeroDays.toLocaleString('en')}{' '}
                    <span className="muted">({Math.round((r.zeroDays / r.days) * 100)}%)</span>
                  </span>
                </td>
                <td data-label="Source">{sourceLabel(r)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
