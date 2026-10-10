import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  createSupplier,
  deleteSupplier,
  listSuppliers,
  updateSupplier,
  type Supplier,
  type SupplierInput,
} from '../api';
import { SupplierForm } from './SupplierForm';
import { Notice } from '../components/Notice';

type Panel = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; supplier: Supplier };

const QUERY_KEY = ['suppliers'];

export function SuppliersPage() {
  const queryClient = useQueryClient();
  const suppliers = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => listSuppliers(signal),
  });

  const [panel, setPanel] = useState<Panel>({ mode: 'closed' });
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const create = useMutation({
    mutationFn: createSupplier,
    onSuccess: async (s) => {
      await refresh();
      setPanel({ mode: 'closed' });
      setNotice({ kind: 'success', text: `Added ${s.name}` });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: SupplierInput }) => updateSupplier(id, input),
    onSuccess: async (s) => {
      await refresh();
      setPanel({ mode: 'closed' });
      setNotice({ kind: 'success', text: `Saved ${s.name}` });
    },
  });

  const remove = useMutation({
    mutationFn: (s: Supplier) => deleteSupplier(s.id),
    onSuccess: async (_void, s) => {
      await refresh();
      setConfirmingId(null);
      setNotice({ kind: 'success', text: `Deleted ${s.name}` });
    },
    onError: (err, s) => {
      setConfirmingId(null);
      setNotice({
        kind: 'error',
        text: `Couldn’t delete ${s.name}: ${err instanceof ApiError ? err.message : 'unexpected error'}`,
      });
    },
  });

  const openPanel = (next: Panel) => {
    setNotice(null);
    setConfirmingId(null);
    setPanel(next);
  };

  const count = suppliers.data?.length ?? 0;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Suppliers</h1>
          <p className="lede">
            Who you buy from, and how many days their deliveries take. Lead times feed the reorder
            forecast.
          </p>
        </div>
        {panel.mode === 'closed' && (
          <button
            type="button"
            className="button--primary"
            onClick={() => openPanel({ mode: 'create' })}
          >
            + Add supplier
          </button>
        )}
      </div>

      <div aria-live="polite">
        {notice && (
          <Notice kind={notice.kind} onDismiss={() => setNotice(null)}>
            {notice.text}
          </Notice>
        )}
      </div>

      {panel.mode === 'create' && (
        <SupplierForm
          onSubmit={(input) => create.mutateAsync(input)}
          onCancel={() => setPanel({ mode: 'closed' })}
        />
      )}
      {panel.mode === 'edit' && (
        <SupplierForm
          key={panel.supplier.id}
          supplier={panel.supplier}
          onSubmit={(input) => update.mutateAsync({ id: panel.supplier.id, input })}
          onCancel={() => setPanel({ mode: 'closed' })}
        />
      )}

      {suppliers.isPending && <p className="muted">Loading suppliers…</p>}

      {suppliers.isError && (
        <div className="banner banner--error" role="alert">
          Couldn’t load suppliers: {suppliers.error.message}{' '}
          <button type="button" onClick={() => suppliers.refetch()}>
            Try again
          </button>
        </div>
      )}

      {suppliers.isSuccess && count === 0 && panel.mode === 'closed' && (
        <div className="card empty">
          <p className="empty__title">No suppliers yet</p>
          <p className="muted">Add the companies you order stock from.</p>
          <button
            type="button"
            className="button--primary"
            onClick={() => openPanel({ mode: 'create' })}
          >
            Add your first supplier
          </button>
        </div>
      )}

      {suppliers.isSuccess && count > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <caption className="table__caption">
              {count} supplier{count === 1 ? '' : 's'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Contact</th>
                <th scope="col" className="num">
                  Lead time
                </th>
                <th scope="col" className="num">
                  Items
                </th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {suppliers.data.map((s) => (
                <tr key={s.id}>
                  <td className="cell-name">
                    <span className="cell-strong">{s.name}</span>
                    {s.notes && <span className="cell-sub">{s.notes}</span>}
                  </td>
                  <td data-label="Contact">
                    {s.contactName || s.email || s.phone ? (
                      <div className="cell-stack">
                        {s.contactName && <span className="cell-strong">{s.contactName}</span>}
                        {s.email && (
                          <a className="cell-sub" href={`mailto:${s.email}`}>
                            {s.email}
                          </a>
                        )}
                        {s.phone && <span className="cell-sub">{s.phone}</span>}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num" data-label="Lead time">
                    {s.leadTimeDays} day{s.leadTimeDays === 1 ? '' : 's'}
                  </td>
                  <td className="num" data-label="Items">
                    {s.itemCount > 0 ? (
                      <Link
                        to={`/items?supplier=${s.id}&archived=1`}
                        aria-label={`${s.itemCount} items from ${s.name}`}
                      >
                        {s.itemCount}
                      </Link>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="actions">
                    {confirmingId === s.id ? (
                      <span
                        className="confirm"
                        role="group"
                        aria-label={`Confirm deleting ${s.name}`}
                      >
                        <span>Delete {s.name}?</span>
                        <button type="button" onClick={() => setConfirmingId(null)}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="button--danger"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(s)}
                        >
                          {remove.isPending ? 'Deleting…' : 'Delete'}
                        </button>
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => openPanel({ mode: 'edit', supplier: s })}
                          aria-label={`Edit ${s.name}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button--ghost-danger"
                          onClick={() => {
                            setNotice(null);
                            setConfirmingId(s.id);
                          }}
                          aria-label={`Delete ${s.name}`}
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
      )}
    </>
  );
}
