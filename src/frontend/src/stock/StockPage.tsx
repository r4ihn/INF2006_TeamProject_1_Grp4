import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listItems } from '../api';
import { Activity } from './Activity';
import { CountSheet } from './CountSheet';
import { History } from './History';
import { RecordForm } from './RecordForm';
import { STOCK_KEYS } from './labels';
import { Notice } from '../components/Notice';

const TABS = [
  { id: 'count', label: 'Stock count', short: 'Count' },
  { id: 'record', label: 'Record delivery / usage', short: 'Record' },
  { id: 'activity', label: 'Activity', short: 'Activity' },
  { id: 'history', label: 'History', short: 'History' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export function StockPage() {
  const items = useQuery({
    queryKey: STOCK_KEYS.items,
    queryFn: ({ signal }) => listItems(signal),
  });
  const active = (items.data ?? []).filter((i) => i.isActive);

  // ?tab=record&item=… lets other pages link straight to the right place
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some((t) => t.id === params.get('tab'))
    ? (params.get('tab') as Tab)
    : 'count';
  const itemId = params.get('item') ?? '';
  const go = (next: Tab, item = itemId) => {
    const p = new URLSearchParams({ tab: next });
    if (item) p.set('item', item);
    setParams(p, { replace: true });
  };

  const [notice, setNotice] = useState<string | null>(null);
  const saved = (message: string) => setNotice(message);

  return (
    <>
      <h1>Stock</h1>
      <p className="lede">
        Record what arrives, what’s used and what you count. Every change is logged, and usage
        builds the history the reorder forecast learns from.
      </p>

      <div className="tabs" role="tablist" aria-label="Stock tasks">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            aria-label={t.label}
            className={`tabs__tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => {
              setNotice(null);
              go(t.id);
            }}
          >
            <span className="tabs__long">{t.label}</span>
            <span className="tabs__short" aria-hidden="true">
              {t.short}
            </span>
          </button>
        ))}
      </div>

      <div aria-live="polite">
        {notice && (
          <Notice kind="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Notice>
        )}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {items.isPending && <p className="muted">Loading items…</p>}
        {items.isError && (
          <div className="banner banner--error" role="alert">
            Couldn’t load items: {items.error.message}{' '}
            <button type="button" onClick={() => items.refetch()}>
              Try again
            </button>
          </div>
        )}
        {items.isSuccess && active.length === 0 && tab !== 'activity' && tab !== 'history' && (
          <div className="card empty">
            <p className="empty__title">No items yet</p>
            <p className="muted">
              <Link to="/items">Add the items you stock</Link> first, then record deliveries and
              counts here.
            </p>
          </div>
        )}
        {items.isSuccess && active.length > 0 && tab === 'count' && (
          <CountSheet items={active} onSaved={saved} />
        )}
        {items.isSuccess && active.length > 0 && tab === 'record' && (
          <RecordForm key={itemId} items={active} initialItemId={itemId} onSaved={saved} />
        )}
        {items.isSuccess && tab === 'activity' && (
          <Activity
            items={items.data}
            itemId={itemId}
            onItemChange={(id) => go('activity', id)}
            onShowHistory={(id) => go('history', id)}
          />
        )}
        {tab === 'history' && <History itemId={itemId} onItemChange={(id) => go('history', id)} />}
      </div>
    </>
  );
}
