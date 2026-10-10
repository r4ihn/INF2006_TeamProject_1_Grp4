import type { ForecastRunSummary, ItemForecast } from '../api';
import { formatQty } from '../format';
import { STATUS_TEXT } from './labels';

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * "How this number was reached": the reorder maths for one item, step by step, with its own
 * numbers — the same formulas as forecasting/cafestock_forecast/reorder.py.
 */
export function Breakdown({ data, run }: { data: ItemForecast; run: ForecastRunSummary }) {
  const { item, recommendation: r } = data;
  const q = (n: number) => formatQty(r1(n), item.unit);
  const z = run.serviceLevelZ;
  const below = r.status !== 'OK';

  return (
    <section className="card breakdown" aria-labelledby="breakdown-title">
      <h2 id="breakdown-title" className="breakdown__title">
        How this number was reached
      </h2>
      <ol className="breakdown__steps">
        <li>
          <span className="breakdown__label">Recent demand</span>
          <span>
            {q(r.avgDailyDemand)} a day on average over the last 28 days, varying by about{' '}
            {q(r.demandStdDev)} a day (σ).
          </span>
        </li>
        <li>
          <span className="breakdown__label">Demand before a delivery arrives</span>
          <span>
            Lead time {r.leadTimeDays} day{r.leadTimeDays === 1 ? '' : 's'}: the forecast for those
            days adds up to <strong>{q(r.leadTimeDemand)}</strong>.
          </span>
        </li>
        <li>
          <span className="breakdown__label">Safety stock</span>
          <span>
            Z × σ × √lead time = {z} × {q(r.demandStdDev)} × √{r.leadTimeDays} ={' '}
            <strong>{q(r.safetyStock)}</strong> — a buffer for demand above the forecast (about a
            95% chance of not running out).
          </span>
        </li>
        <li>
          <span className="breakdown__label">Reorder point</span>
          <span>
            {q(r.leadTimeDemand)} + {q(r.safetyStock)} = <strong>{q(r.reorderPoint)}</strong>
          </span>
        </li>
        <li>
          <span className="breakdown__label">On hand</span>
          <span>
            <strong>{q(r.onHand)}</strong> —{' '}
            {r.status === 'URGENT'
              ? `less than the ${q(r.leadTimeDemand)} expected before a delivery could arrive: urgent.`
              : r.status === 'REORDER'
                ? `below the reorder point by ${q(r.shortfall)}: time to order.`
                : `at or above the reorder point: no order needed yet.`}
          </span>
        </li>
        {below && (
          <>
            <li>
              <span className="breakdown__label">Order up to</span>
              <span>
                Reorder point + the forecast for the {run.reviewDays} days after the delivery:{' '}
                {q(r.reorderPoint)} + {q(r.reviewDemand)} = <strong>{q(r.orderUpTo)}</strong>
              </span>
            </li>
            <li>
              <span className="breakdown__label">Recommended order</span>
              <span>
                {q(r.orderUpTo)} − {q(r.onHand)} on hand ={' '}
                {r.spoilageCapApplied ? (
                  <>
                    {q(r.orderUpTo - r.onHand)}, limited to the spoilage cap:{' '}
                    <strong>{q(r.recommendedQty)}</strong> (more would expire before it is used).
                  </>
                ) : (
                  <strong>{q(r.recommendedQty)}</strong>
                )}
              </span>
            </li>
          </>
        )}
      </ol>
      <p className="breakdown__result">
        <span className={`status status--${r.status.toLowerCase()}`}>{STATUS_TEXT[r.status]}</span>
        {below ? ` Order ${q(r.recommendedQty)} of ${item.name}.` : ' Nothing to order.'}
      </p>
      <p className="muted breakdown__accuracy">
        This item’s forecast error on the last {run.evalWeeks} weeks:{' '}
        {r.itemMase === null ? 'not enough history to measure' : `MASE ${r.itemMase.toFixed(2)}`}
        {r.itemMase !== null &&
          (r.itemMase < 1
            ? ' (better than “same day last week”)'
            : ' (no better than “same day last week”)')}
        .
      </p>
      {r.notes.length > 0 && (
        <ul className="breakdown__notes">
          {r.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
