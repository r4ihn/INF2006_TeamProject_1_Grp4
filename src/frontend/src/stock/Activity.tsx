import { useQuery } from '@tanstack/react-query';
import { getDemand, listMovements, type Item } from '../api';
import { formatDateTime, formatDay, formatQty, formatSigned, formatWeekday } from '../format';
import { StatLine } from '../components/StatLine';
import { MOVEMENT_LABEL, STOCK_KEYS } from './labels';

interface Props {
  items: Item[];
  itemId: string;
  onItemChange: (itemId: string) => void;
  onShowHistory: (itemId: string) => void;
}

/** Recent stock changes, and — for one item — its daily usage (the forecast's input). */
export function Activity({ items, itemId, onItemChange, onShowHistory }: Props) {
  const movements = useQuery({
    queryKey: [...STOCK_KEYS.movements, itemId],
    queryFn: ({ signal }) => listMovements({ itemId: itemId || undefined, limit: 100 }, signal),
  });
  const item = items.find((i) => i.id === itemId);

  return (
    <>
      <div className="toolbar">
        <select
          aria-label="Show activity for"
          value={itemId}
          onChange={(e) => onItemChange(e.target.value)}
        >
          <option value="">All items</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </div>

      {item && <DailyUsage item={item} onShowHistory={() => onShowHistory(item.id)} />}

      {movements.isPending && <p className="muted">Loading activity…</p>}
      {movements.isError && (
        <p className="banner banner--error" role="alert">
          Couldn’t load activity: {movements.error.message}
        </p>
      )}
      {movements.isSuccess && movements.data.length === 0 && (
        <div className="card empty">
          <p className="empty__title">No stock activity yet</p>
          <p className="muted">Deliveries, usage and counts you record will appear here.</p>
        </div>
      )}
      {movements.isSuccess && movements.data.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <caption className="table__caption">
              Latest {movements.data.length} change{movements.data.length === 1 ? '' : 's'}
              {item ? ` for ${item.name}` : ''}
            </caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                {!item && <th scope="col">Item</th>}
                <th scope="col">What</th>
                <th scope="col" className="num">
                  Change
                </th>
                <th scope="col" className="num">
                  After
                </th>
                <th scope="col">Note</th>
                <th scope="col">By</th>
              </tr>
            </thead>
            <tbody>
              {movements.data.map((m) => (
                <tr key={m.id}>
                  <td className="cell-name">
                    <span className="cell-strong">{formatDateTime(m.occurredAt)}</span>
                  </td>
                  {!item && <td data-label="Item">{m.item.name}</td>}
                  <td data-label="What">
                    <span className={`badge badge--${m.type.toLowerCase()}`}>
                      {MOVEMENT_LABEL[m.type]}
                    </span>
                  </td>
                  <td className="num" data-label="Change">
                    <span
                      className={`diff ${
                        m.quantityChange < 0
                          ? 'diff--short'
                          : m.quantityChange > 0
                            ? 'diff--over'
                            : 'diff--zero'
                      }`}
                    >
                      {formatSigned(m.quantityChange, m.item.unit)}
                    </span>
                  </td>
                  <td className="num" data-label="After">
                    {formatQty(m.quantityAfter, m.item.unit)}
                  </td>
                  <td data-label="Note">{m.note ?? <span className="muted">—</span>}</td>
                  <td data-label="By">
                    {m.createdBy ? (
                      (m.createdBy.displayName ?? m.createdBy.email)
                    ) : m.imported ? (
                      <span className="muted">Dataset import</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function DailyUsage({ item, onShowHistory }: { item: Item; onShowHistory: () => void }) {
  const demand = useQuery({
    queryKey: [...STOCK_KEYS.demand, item.id, 14],
    queryFn: ({ signal }) => getDemand(item.id, 14, signal),
  });
  if (!demand.isSuccess) return null;
  const d = demand.data;

  return (
    <section className="card usage" aria-label={`Daily usage of ${item.name}`}>
      <div className="usage__header">
        <h2 className="usage__title">Daily usage — last 14 days</h2>
        <div className="usage__totals">
          <StatLine
            stats={[
              { label: 'Total', value: formatQty(d.total, d.unit) },
              { label: 'Average a day', value: formatQty(d.averagePerDay, d.unit) },
            ]}
          />
          <button type="button" className="link-button link-button--inline" onClick={onShowHistory}>
            Full history
          </button>
        </div>
      </div>
      <p className="field__hint">
        Usage you record, plus shortfalls found by stock counts. This is what the forecast learns
        from.
      </p>
      <ol className="usage__days">
        {d.days.map((day) => (
          <li key={day.date} className={day.quantity > 0 ? 'has-usage' : undefined}>
            <span className="usage__weekday">{formatWeekday(day.date)}</span>
            <span className="usage__date">{formatDay(day.date)}</span>
            <span className="usage__qty">{day.quantity > 0 ? formatQty(day.quantity) : '–'}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
