import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  createItem,
  deleteItem,
  listItems,
  listSuppliers,
  updateItem,
  type Item,
  type ItemInput,
} from '../api';
import { formatMoney, formatQty } from '../format';
import { ItemForm } from './ItemForm';
import { Notice } from '../components/Notice';

type Panel = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; item: Item };
type PageNotice = { kind: 'success' | 'error'; text: string; undo?: () => void };

const ITEMS = ['items'];
const SUPPLIERS = ['suppliers'];

export function ItemsPage() {
  const queryClient = useQueryClient();
  const items = useQuery({ queryKey: ITEMS, queryFn: ({ signal }) => listItems(signal) });
  // Suppliers feed the form's picker and the filter; the page still works without them.
  const suppliers = useQuery({
    queryKey: SUPPLIERS,
    queryFn: ({ signal }) => listSuppliers(signal),
  });

  // Filters live in the URL (?q=milk&category=Dairy&supplier=…&archived=1), so links such
  // as "3 items" on the Suppliers page can open a pre-filtered list.
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const supplier = params.get('supplier') ?? '';
  const showArchived = params.get('archived') === '1';
  const setParam = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const [panel, setPanel] = useState<Panel>({ mode: 'closed' });
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<PageNotice | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ITEMS }),
      // Item counts on the Suppliers page change too
      queryClient.invalidateQueries({ queryKey: SUPPLIERS }),
    ]);

  const create = useMutation({
    mutationFn: createItem,
    onSuccess: async (item) => {
      await refresh();
      setPanel({ mode: 'closed' });
      setNotice({ kind: 'success', text: `Added ${item.name}` });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ItemInput }) => updateItem(id, input),
    onSuccess: async (item) => {
      await refresh();
      setPanel({ mode: 'closed' });
      setNotice({ kind: 'success', text: `Saved ${item.name}` });
    },
  });

  const setActive = useMutation({
    mutationFn: ({ item, isActive }: { item: Item; isActive: boolean }) =>
      updateItem(item.id, { isActive }),
    onSuccess: async (updated, { item, isActive }) => {
      await refresh();
      setNotice(
        isActive
          ? { kind: 'success', text: `Restored ${updated.name}` }
          : {
              kind: 'success',
              text: `Archived ${updated.name}. It’s hidden from lists but keeps its history.`,
              undo: () => setActive.mutate({ item, isActive: true }),
            },
      );
    },
    onError: (err, { item }) =>
      setNotice({ kind: 'error', text: `Couldn’t update ${item.name}: ${errorText(err)}` }),
  });

  const remove = useMutation({
    mutationFn: (item: Item) => deleteItem(item.id),
    onSuccess: async (_void, item) => {
      await refresh();
      setConfirmingId(null);
      setNotice({ kind: 'success', text: `Deleted ${item.name}` });
    },
    onError: (err, item) => {
      setConfirmingId(null);
      setNotice({ kind: 'error', text: `Couldn’t delete ${item.name}: ${errorText(err)}` });
    },
  });

  const openPanel = (next: Panel) => {
    setNotice(null);
    setConfirmingId(null);
    setPanel(next);
  };

  const all = useMemo(() => items.data ?? [], [items.data]);
  const categories = useMemo(
    () =>
      [...new Set(all.map((i) => i.category))].sort((a, b) =>
        a.localeCompare(b, 'en', { sensitivity: 'base' }),
      ),
    [all],
  );
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(
      (i) =>
        (showArchived || i.isActive) &&
        (!category || i.category === category) &&
        (!supplier || i.supplier?.id === supplier) &&
        (!needle ||
          i.name.toLowerCase().includes(needle) ||
          (i.sku ?? '').toLowerCase().includes(needle)),
    );
  }, [all, q, category, supplier, showArchived]);

  const activeCount = all.filter((i) => i.isActive).length;
  const lowCount = all.filter((i) => i.isActive && i.isLow).length;
  const filtered = Boolean(q || category || supplier);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Items</h1>
          <p className="lede">
            Everything you stock. Items at or below their reorder point are flagged as low — record
            deliveries and counts on the <Link to="/stock">Stock</Link> page.
          </p>
        </div>
        {panel.mode === 'closed' && (
          <button
            type="button"
            className="button--primary"
            onClick={() => openPanel({ mode: 'create' })}
          >
            + Add item
          </button>
        )}
      </div>

      <div aria-live="polite">
        {notice && (
          <Notice kind={notice.kind} onDismiss={() => setNotice(null)}>
            {notice.text}
            {notice.undo && (
              <button type="button" onClick={notice.undo}>
                Undo
              </button>
            )}
          </Notice>
        )}
      </div>

      {panel.mode !== 'closed' && (
        <ItemForm
          key={panel.mode === 'edit' ? panel.item.id : 'new'}
          item={panel.mode === 'edit' ? panel.item : undefined}
          suppliers={suppliers.data ?? []}
          categories={categories}
          onSubmit={(input) =>
            panel.mode === 'edit'
              ? update.mutateAsync({ id: panel.item.id, input })
              : create.mutateAsync(input)
          }
          onCancel={() => setPanel({ mode: 'closed' })}
        />
      )}

      {items.isPending && <p className="muted">Loading items…</p>}

      {items.isError && (
        <div className="banner banner--error" role="alert">
          Couldn’t load items: {items.error.message}{' '}
          <button type="button" onClick={() => items.refetch()}>
            Try again
          </button>
        </div>
      )}

      {items.isSuccess && all.length === 0 && panel.mode === 'closed' && (
        <div className="card empty">
          <p className="empty__title">No items yet</p>
          <p className="muted">
            Add what you stock — beans, milk, cups… Link each one to a supplier so the forecast
            knows its delivery time.
          </p>
          <button
            type="button"
            className="button--primary"
            onClick={() => openPanel({ mode: 'create' })}
          >
            Add your first item
          </button>
        </div>
      )}

      {items.isSuccess && all.length > 0 && (
        <>
          <div className="toolbar" role="search">
            <input
              type="search"
              className="toolbar__search"
              placeholder="Search name or SKU"
              aria-label="Search items"
              value={q}
              onChange={(e) => setParam('q', e.target.value)}
            />
            <select
              aria-label="Filter by category"
              value={category}
              onChange={(e) => setParam('category', e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by supplier"
              value={supplier}
              onChange={(e) => setParam('supplier', e.target.value)}
            >
              <option value="">All suppliers</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <label className="toolbar__check">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setParam('archived', e.target.checked ? '1' : '')}
              />
              Show archived
            </label>
          </div>

          <div className="card table-wrap">
            <table className="table">
              <caption className="table__caption">
                {filtered ? `${visible.length} of ` : ''}
                {activeCount} item{activeCount === 1 ? '' : 's'}
                {lowCount > 0 && (
                  <>
                    {' · '}
                    <span className="badge badge--low">{lowCount} low</span>
                  </>
                )}
                {filtered && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setParams({}, { replace: true })}
                  >
                    Clear filters
                  </button>
                )}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Category</th>
                  <th scope="col">Supplier</th>
                  <th scope="col" className="num">
                    On hand
                  </th>
                  <th scope="col" className="num">
                    Reorder at
                  </th>
                  <th scope="col" className="num">
                    Unit cost
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No items match these filters.
                    </td>
                  </tr>
                )}
                {visible.map((item) => (
                  <tr key={item.id} className={item.isActive ? undefined : 'row--archived'}>
                    <td className="cell-name">
                      <span className="cell-strong">
                        {item.name}
                        {!item.isActive && <span className="badge">Archived</span>}
                      </span>
                      {item.sku && <span className="cell-sub">{item.sku}</span>}
                    </td>
                    <td data-label="Category">{item.category}</td>
                    <td data-label="Supplier">
                      {item.supplier ? (
                        <span>
                          {item.supplier.name}
                          <span className="cell-sub">
                            {item.supplier.leadTimeDays} day
                            {item.supplier.leadTimeDays === 1 ? '' : 's'} lead time
                          </span>
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num" data-label="On hand">
                      <span>
                        <Link
                          to={`/stock?tab=activity&item=${item.id}`}
                          className="qty-link"
                          aria-label={`${formatQty(item.onHand, item.unit)} of ${item.name} on hand — see stock history`}
                        >
                          {formatQty(item.onHand, item.unit)}
                        </Link>
                        {item.isActive && item.isLow && (
                          <span className="badge badge--low">Low</span>
                        )}
                      </span>
                    </td>
                    <td className="num" data-label="Reorder at">
                      <span>
                        {formatQty(item.reorderPoint, item.unit)}
                        {item.spoilageCap !== null && (
                          <span className="cell-sub">
                            max {formatQty(item.spoilageCap, item.unit)}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="num" data-label="Unit cost">
                      {formatMoney(item.unitCost)}
                    </td>
                    <td className="actions">
                      {confirmingId === item.id ? (
                        <span
                          className="confirm"
                          role="group"
                          aria-label={`Confirm deleting ${item.name}`}
                        >
                          <span>Delete for good?</span>
                          <button type="button" onClick={() => setConfirmingId(null)}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="button--danger"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(item)}
                          >
                            {remove.isPending ? 'Deleting…' : 'Delete'}
                          </button>
                        </span>
                      ) : item.isActive ? (
                        <>
                          <button
                            type="button"
                            onClick={() => openPanel({ mode: 'edit', item })}
                            aria-label={`Edit ${item.name}`}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="button--ghost"
                            disabled={setActive.isPending}
                            onClick={() => {
                              setNotice(null);
                              setActive.mutate({ item, isActive: false });
                            }}
                            aria-label={`Archive ${item.name}`}
                          >
                            Archive
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={setActive.isPending}
                            onClick={() => setActive.mutate({ item, isActive: true })}
                            aria-label={`Restore ${item.name}`}
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            className="button--ghost-danger"
                            onClick={() => {
                              setNotice(null);
                              setConfirmingId(item.id);
                            }}
                            aria-label={`Delete ${item.name}`}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {suppliers.isSuccess && suppliers.data.length === 0 && (
            <p className="muted footnote">
              Tip: <Link to="/suppliers">add your suppliers</Link> so items know their delivery
              times.
            </p>
          )}
        </>
      )}
    </>
  );
}

function errorText(err: unknown) {
  return err instanceof ApiError ? err.message : 'unexpected error';
}
