import { useEffect, useState } from 'react'
import { api, type Movement, type StockItem } from '../api.ts'
import { formatDateTime, formatQuantity } from '../format.ts'

const PAGE = 15

const LABELS: Record<Movement['movementType'], string> = {
  RECEIVE: 'Received',
  SELL: 'Sold / used',
  SPOILAGE: 'Spoilage',
  ADJUST: 'Adjustment',
}

interface Props {
  items: StockItem[]
  refreshKey: number
}

export default function MovementList({ items, refreshKey }: Props) {
  const [rows, setRows] = useState<Movement[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  const products = new Map(items.map((i) => [i.productId, i]))

  useEffect(() => {
    let cancelled = false
    api
      .movements({ limit: PAGE })
      .then((page) => {
        if (cancelled) return
        setRows(page)
        setMore(page.length === PAGE)
        setError('')
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  async function older() {
    const last = rows?.[rows.length - 1]
    if (!last) return
    try {
      const page = await api.movements({ limit: PAGE, beforeId: last.movementId })
      setRows((prev) => [...(prev ?? []), ...page])
      setMore(page.length === PAGE)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section className="card" aria-labelledby="history-heading">
      <h2 id="history-heading">Recent movements</h2>
      {error && <p className="banner error" role="alert">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Item</th>
              <th scope="col">Type</th>
              <th scope="col" className="num">Quantity</th>
              <th scope="col">Batch</th>
              <th scope="col">By</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((m) => {
              const p = products.get(m.productId)
              return (
                <tr key={m.movementId}>
                  <td>{formatDateTime(m.occurredAt)}</td>
                  <th scope="row">{p?.name ?? `Item ${m.productId}`}</th>
                  <td>{LABELS[m.movementType]}</td>
                  <td className={`num ${m.quantity < 0 ? 'neg' : 'pos'}`}>
                    {m.quantity > 0 ? '+' : '−'}
                    {formatQuantity(Math.abs(m.quantity), p?.unit ?? 'unit')}
                  </td>
                  <td>{m.batchId}</td>
                  <td>{m.recordedBy ?? (m.source === 'app' ? '—' : 'dataset')}</td>
                  <td>{m.reason ?? '—'}</td>
                </tr>
              )
            })}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">No movements recorded yet.</td>
              </tr>
            )}
            {rows === null && !error && (
              <tr>
                <td colSpan={7} className="empty">Loading…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {more && (
        <button type="button" onClick={older} className="more">
          Load older movements
        </button>
      )}
    </section>
  )
}
