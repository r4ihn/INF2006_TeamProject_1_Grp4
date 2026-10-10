import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, recordCount, type Item, type StockChangeResult } from '../api';
import { Stepper } from '../components/Stepper';
import { formatQty, formatSigned, hasAtMostDecimals, parseNumber } from '../format';
import { STOCK_KEYS } from './labels';

interface Props {
  items: Item[];
  onSaved: (message: string) => void;
}

/**
 * The end-of-day stocktake: type what's physically on the shelf for any items you counted,
 * see the difference from what the system expected, save them all at once.
 */
export function CountSheet({ items, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState<string | null>(null);

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category))].sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const shown = category ? items.filter((i) => i.category === category) : items;

  // Rows the user has typed something into
  const entries = items
    .map((item) => ({ item, text: counted[item.id] ?? '' }))
    .filter((e) => e.text.trim() !== '');
  const invalid = entries.filter((e) => {
    const n = parseNumber(e.text);
    return n === null || Number.isNaN(n) || n < 0 || !hasAtMostDecimals(n, 3);
  });

  const save = useMutation({
    mutationFn: () =>
      recordCount({
        counts: entries.map((e) => ({ itemId: e.item.id, counted: parseNumber(e.text)! })),
        note: note.trim() || undefined,
      }),
    onSuccess: async ({ changes }) => {
      await Promise.all(
        Object.values(STOCK_KEYS).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      setCounted({});
      setNote('');
      setError(null);
      onSaved(summarise(changes));
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Couldn’t save the count. Try again.'),
  });

  if (items.length === 0) {
    return (
      <div className="card empty">
        <p className="empty__title">Nothing to count yet</p>
        <p className="muted">Add items on the Items page first.</p>
      </div>
    );
  }

  return (
    <form
      aria-label="Stock count"
      onSubmit={(e) => {
        e.preventDefault();
        if (entries.length && !invalid.length) save.mutate();
      }}
    >
      <div className="toolbar">
        <select
          aria-label="Count category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <p className="muted toolbar__hint">
          Type what’s on the shelf for the items you counted. Leave the rest blank.
        </p>
      </div>

      {error && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}

      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="num">
                Expected
              </th>
              <th scope="col" className="num">
                Counted
              </th>
              <th scope="col" className="num">
                Difference
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((item) => {
              const text = counted[item.id] ?? '';
              const value = parseNumber(text);
              const bad =
                text.trim() !== '' &&
                (value === null ||
                  Number.isNaN(value) ||
                  value < 0 ||
                  !hasAtMostDecimals(value, 3));
              const diff = !bad && value !== null ? round3(value - item.onHand) : null;
              const inputId = `count-${item.id}`;
              return (
                <tr key={item.id} className={text ? 'row--editing' : undefined}>
                  <td className="cell-name">
                    <label htmlFor={inputId} className="cell-strong">
                      {item.name}
                    </label>
                    <span className="cell-sub">{item.category}</span>
                  </td>
                  <td className="num" data-label="Expected">
                    {formatQty(item.onHand, item.unit)}
                  </td>
                  <td className="num" data-label="Counted">
                    <Stepper
                      value={text}
                      onChange={(v) => setCounted((c) => ({ ...c, [item.id]: v }))}
                      label={`count of ${item.name}`}
                      startFrom={item.onHand}
                      unit={item.unit}
                      inputProps={{
                        id: inputId,
                        placeholder: '—',
                        'aria-invalid': bad || undefined,
                      }}
                    />
                    {bad && <span className="field__error">Enter 0 or more, up to 3 decimals</span>}
                  </td>
                  <td className="num" data-label="Difference">
                    {diff === null ? (
                      <span className="muted">—</span>
                    ) : diff === 0 ? (
                      <span className="diff diff--zero">Matches</span>
                    ) : (
                      <span className={`diff ${diff < 0 ? 'diff--short' : 'diff--over'}`}>
                        {formatSigned(diff, item.unit)}
                        <span className="cell-sub">{diff < 0 ? 'used / missing' : 'extra'}</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="savebar">
        <p className="savebar__count">
          {entries.length === 0
            ? 'No items counted yet'
            : `${entries.length} item${entries.length === 1 ? '' : 's'} counted`}
        </p>
        <input
          className="savebar__note"
          aria-label="Note for this count"
          placeholder="Note (optional), e.g. Closing count"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setCounted({})}
          disabled={entries.length === 0 || save.isPending}
        >
          Clear
        </button>
        <button
          type="submit"
          className="button--primary"
          disabled={entries.length === 0 || invalid.length > 0 || save.isPending}
        >
          {save.isPending ? 'Saving…' : 'Save count'}
        </button>
      </div>
    </form>
  );
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function summarise(changes: StockChangeResult[]): string {
  const used = changes
    .filter((c) => c.demandRecorded > 0)
    .map((c) => `${formatQty(c.demandRecorded, c.item.unit)} ${c.item.name}`);
  const base = `Saved count for ${changes.length} item${changes.length === 1 ? '' : 's'}`;
  return used.length ? `${base} | Recorded as used: ${used.join(', ')}` : base;
}
