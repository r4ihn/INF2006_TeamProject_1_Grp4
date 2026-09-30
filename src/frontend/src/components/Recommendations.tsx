import { useEffect, useState } from 'react'
import { api, type ForecastRun, type Recommendation } from '../api.ts'
import { formatDate, formatQuantity } from '../format.ts'

// Intl rounds the decimal value (91.65% -> 91.7%); (0.9165 * 100).toFixed(1) would give 91.6 because of float error.
const percent = new Intl.NumberFormat('en-SG', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })
const pct = (n: number) => percent.format(n)

function orderText(r: Recommendation): { main: string; sub?: string } {
  const { packs, units } = r.suggested
  if (packs === 0) return { main: 'No order needed' }
  const pack = r.packDescription ?? `${r.packSize} ${r.unit}`
  return { main: `${packs} × ${pack}`, sub: formatQuantity(units, r.unit) }
}

function Reliability({ run, items }: { run: ForecastRun; items: Recommendation[] }) {
  const { accuracy, simulatedYear } = run.evaluation
  const weak = items.filter((i) => i.methodMase !== null && i.methodMase > 1).map((i) => i.name)
  return (
    <section className="card" aria-labelledby="reliable-heading">
      <h2 id="reliable-heading">How reliable is this?</h2>
      <ul className="plain">
        {accuracy && (
          <li>
            <strong>Forecast error:</strong> {accuracy.method} scored {accuracy.mase.toFixed(3)} against{' '}
            {accuracy.baselineMase.toFixed(3)} for simply repeating last week's usage (lower is better), so about{' '}
            {pct(1 - accuracy.mase / accuracy.baselineMase)} less error. That is a small
            improvement, not a dramatic one.
          </li>
        )}
        {simulatedYear?.withForecast && simulatedYear.withoutForecast && (
          <li>
            <strong>Simulated year:</strong> with this forecast the shop would have had{' '}
            {simulatedYear.withForecast.stockoutDays} stock-out days instead of{' '}
            {simulatedYear.withoutForecast.stockoutDays} with a fixed reorder level (service level{' '}
            {pct(simulatedYear.withoutForecast.serviceLevel)} → {pct(simulatedYear.withForecast.serviceLevel)}).
          </li>
        )}
        {weak.length > 0 && (
          <li>
            <strong>Weaker than repeating last week: {weak.join(', ')}.</strong> Treat those numbers as a starting point and
            use your judgement, especially for anything that spoils quickly.
          </li>
        )}
        <li>
          <strong>Demo data:</strong> sales come from a real coffee-shop export, but recipe quantities, deliveries, spoilage,
          pack sizes and shelf lives are simulated, and there is one year of history at one location.
        </li>
      </ul>
    </section>
  )
}

export default function Recommendations({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<{ run: ForecastRun | null; items: Recommendation[] } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .recommendations()
      .then((d) => {
        if (cancelled) return
        setData(d)
        setError('')
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  if (error) return <p className="banner error wide" role="alert">{error}</p>
  if (!data) return <p className="muted wide">Loading reorder plan…</p>
  if (!data.run) return <p className="card">No forecast has been loaded yet.</p>

  const { run } = data
  const items = [...data.items].sort(
    (a, b) => Number(b.suggested.packs > 0) - Number(a.suggested.packs > 0) || a.name.localeCompare(b.name),
  )
  const toOrder = items.filter((i) => i.suggested.packs > 0).length

  return (
    <div className="stack">
      <p className="banner warn" role="note">
        Based on sales up to <strong>{formatDate(run.asOf)}</strong> ({run.method} forecast). Stock on hand is live;
        the forecast and safety stock are from that analysis.
      </p>

      <section className="card" aria-labelledby="reorder-heading">
        <div className="card-head">
          <h2 id="reorder-heading">Reorder plan</h2>
          <span className={toOrder > 0 ? 'badge low' : 'badge ok'}>
            {toOrder} of {items.length} items to order
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">On hand now</th>
                <th scope="col" className="num">Forecast next week</th>
                <th scope="col" className="num">Safety stock</th>
                <th scope="col">Suggested order</th>
                <th scope="col" className="num">Cover after order</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const order = orderText(r)
                return (
                  <tr key={r.productId}>
                    <th scope="row">
                      {r.name}
                      <span className="sub">{r.sku}</span>
                    </th>
                    <td className="num">{formatQuantity(r.onHand, r.unit)}</td>
                    <td className="num">{formatQuantity(r.forecastNextWeek, r.unit)}</td>
                    <td className="num">{formatQuantity(r.safetyStock, r.unit)}</td>
                    <td>
                      <strong className={r.suggested.packs > 0 ? 'order' : 'muted'}>{order.main}</strong>
                      {order.sub && <span className="sub">{order.sub}</span>}
                    </td>
                    <td className="num">
                      {r.suggested.weeksOfCover === null ? '—' : `${r.suggested.weeksOfCover} wk`}
                    </td>
                    <td>
                      {r.suggested.cappedByShelfLife && (
                        <span className="badge expired" title="Ordering the full shortfall would be more than can be sold before it expires">
                          Limited by shelf life
                        </span>
                      )}
                      {r.methodMase !== null && r.methodMase > 1 && (
                        <span className="badge expired" title={`Forecast error ${r.methodMase.toFixed(3)} vs 1.000 for repeating last week`}>
                          Weak forecast
                        </span>
                      )}
                      {r.expiredQuantity > 0 && (
                        <span className="badge expired" title="On-hand figure includes stock past its expiry date, so the real need may be higher">
                          Includes {formatQuantity(r.expiredQuantity, r.unit)} expired
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="how-heading">
        <h2 id="how-heading">How the suggested order is worked out</h2>
        <ol className="plain">
          <li><strong>Forecast:</strong> the average of the last two complete weeks' usage.</li>
          <li>
            <strong>Safety stock:</strong> {run.serviceZ} × how much weekly usage has varied over the last 8 weeks, a buffer
            that covers about 95% of weeks.
          </li>
          <li><strong>Need:</strong> the forecast for {run.coverWeeks === 1 ? 'one week' : `${run.coverWeeks} weeks`} plus the safety stock.</li>
          <li><strong>Order:</strong> need minus what is on hand now, rounded up to whole supplier packs.</li>
          <li><strong>Shelf-life limit:</strong> never more than half a shelf life's worth of forecast sales, so it is sold before it expires.</li>
        </ol>
      </section>

      <Reliability run={run} items={items} />
    </div>
  )
}
