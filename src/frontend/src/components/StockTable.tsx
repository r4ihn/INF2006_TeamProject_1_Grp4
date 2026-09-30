import { useState } from 'react'
import type { StockItem } from '../api.ts'
import { formatDate, formatQuantity } from '../format.ts'

interface Props {
  items: StockItem[]
  onRecord: (productId: number) => void
}

export default function StockTable({ items, onRecord }: Props) {
  const [lowOnly, setLowOnly] = useState(false)
  const shown = lowOnly ? items.filter((i) => i.isLow) : items

  return (
    <section className="card" aria-labelledby="stock-heading">
      <div className="card-head">
        <h2 id="stock-heading">Current stock</h2>
        <label className="check">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Low stock only
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="num">On hand</th>
              <th scope="col" className="num">Reorder at</th>
              <th scope="col">Status</th>
              <th scope="col">Earliest expiry</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.productId}>
                <th scope="row">
                  {i.name}
                  <span className="sub">{i.sku}</span>
                </th>
                <td className="num">{formatQuantity(i.onHand, i.unit)}</td>
                <td className="num">{formatQuantity(i.reorderThreshold, i.unit)}</td>
                <td>
                  {i.isLow ? (
                    <span className="badge low">Reorder now</span>
                  ) : (
                    <span className="badge ok">OK</span>
                  )}
                  {i.expiredQuantity > 0 && (
                    <span className="badge expired" title="Stock past its expiry date that has not been written off">
                      {formatQuantity(i.expiredQuantity, i.unit)} expired
                    </span>
                  )}
                </td>
                <td>{formatDate(i.earliestExpiry)}</td>
                <td>
                  <button type="button" onClick={() => onRecord(i.productId)} aria-label={`Record movement for ${i.name}`}>
                    Record
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  {lowOnly ? 'Nothing is below its reorder level.' : 'No items yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
