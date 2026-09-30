import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type Batch, type MovementResult, type MovementType, type NewMovement, type StockItem } from '../api.ts'
import type { Role } from '../auth.ts'
import { formatDate, formatQuantity } from '../format.ts'

const TYPES: { value: MovementType; label: string; managerOnly: boolean; hint: string }[] = [
  { value: 'RECEIVE', label: 'Receive delivery', managerOnly: false, hint: 'Adds a new batch to stock.' },
  {
    value: 'SELL',
    label: 'Record usage / sale',
    managerOnly: false,
    hint: 'Takes stock from the batch that expires first, unless you choose one.',
  },
  {
    value: 'SPOILAGE',
    label: 'Write off spoilage',
    managerOnly: true,
    hint: 'Removes stock from one batch. A reason is required.',
  },
  {
    value: 'ADJUST',
    label: 'Stocktake adjustment',
    managerOnly: true,
    hint: 'Corrects a batch after a count: positive adds stock, negative removes it. A reason is required.',
  },
]

interface Props {
  items: StockItem[]
  role: Role
  productId: number | null
  onProductChange: (productId: number) => void
  onRecorded: (result: MovementResult) => void
}

export default function MovementForm({ items, role, productId, onProductChange, onRecorded }: Props) {
  const [type, setType] = useState<MovementType>('RECEIVE')
  const [quantity, setQuantity] = useState('')
  const [batchId, setBatchId] = useState('')
  const [expiry, setExpiry] = useState('')
  const [reason, setReason] = useState('')
  const [batches, setBatches] = useState<{ productId: number; list: Batch[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string[]>([])
  const [success, setSuccess] = useState('')

  const product = items.find((i) => i.productId === productId)
  const meta = TYPES.find((t) => t.value === type)!
  const needsBatch = type === 'SPOILAGE' || type === 'ADJUST'
  const usesBatches = type !== 'RECEIVE'
  const [batchVersion, setBatchVersion] = useState(0)

  // Load the product's batches whenever a batch picker is needed, and again after each save.
  useEffect(() => {
    if (!usesBatches || productId === null) return
    let cancelled = false
    api
      .batches(productId)
      .then((list) => !cancelled && setBatches({ productId, list }))
      .catch(() => !cancelled && setBatches({ productId, list: [] }))
    return () => {
      cancelled = true
    }
  }, [productId, usesBatches, batchVersion])
  const batchList = batches && batches.productId === productId ? batches.list : null

  function validate(): string | null {
    if (!product) return 'Choose an item.'
    const q = Number(quantity)
    if (quantity.trim() === '' || !Number.isFinite(q)) return 'Enter a quantity.'
    if (type === 'ADJUST' ? q === 0 : q <= 0) return type === 'ADJUST' ? 'The change cannot be zero.' : 'Quantity must be greater than zero.'
    if (product.unit === 'unit' && !Number.isInteger(q)) return `${product.name} is counted in whole units.`
    if (needsBatch && !batchId) return 'Choose the batch.'
    if (needsBatch && !reason.trim()) return 'Give a reason.'
    return null
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSuccess('')
    const problem = validate()
    if (problem) {
      setError([problem])
      return
    }
    const body: NewMovement = { productId: product!.productId, movementType: type, quantity: Number(quantity) }
    if (batchId) body.batchId = batchId
    if (type === 'RECEIVE' && expiry) body.expiryDate = expiry
    if (reason.trim()) body.reason = reason.trim()

    setBusy(true)
    setError([])
    try {
      const result = await api.record(body)
      const moved = result.movements.reduce((sum, m) => sum + Math.abs(m.quantity), 0)
      const spread = result.movements.length > 1 ? ` (across ${result.movements.length} batches)` : ''
      setSuccess(
        `${meta.label}: ${formatQuantity(moved, product!.unit)}${spread}. ${product!.name} now has ${formatQuantity(result.onHand, product!.unit)} on hand.`,
      )
      setQuantity('')
      setReason('')
      setExpiry('')
      setBatchId('')
      setBatchVersion((v) => v + 1) // refresh the batch list
      onRecorded(result)
    } catch (err) {
      if (err instanceof ApiError) {
        const details = Array.isArray(err.details)
          ? err.details.map((d: { path?: string; message?: string }) => `${d.path ? d.path + ': ' : ''}${d.message}`)
          : []
        setError([err.message, ...details])
      } else {
        setError(['Something went wrong. Please try again.'])
      }
    } finally {
      setBusy(false)
    }
  }

  function changeType(next: MovementType) {
    setType(next)
    setBatchId('')
    setError([])
    setSuccess('')
  }

  return (
    <section className="card" aria-labelledby="form-heading">
      <h2 id="form-heading">Record a movement</h2>
      <form onSubmit={submit} className="stack" noValidate>
        <div className="field">
          <label htmlFor="product">Item</label>
          <select
            id="product"
            value={productId ?? ''}
            onChange={(e) => {
              onProductChange(Number(e.target.value))
              setBatchId('')
            }}
          >
            <option value="" disabled>
              Choose an item…
            </option>
            {items.map((i) => (
              <option key={i.productId} value={i.productId}>
                {i.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="type">What happened?</label>
          <select id="type" value={type} onChange={(e) => changeType(e.target.value as MovementType)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value} disabled={t.managerOnly && role !== 'manager'}>
                {t.label}
                {t.managerOnly && role !== 'manager' ? ' (manager only)' : ''}
              </option>
            ))}
          </select>
          <p className="hint">{meta.hint}</p>
        </div>

        <div className="field">
          <label htmlFor="quantity">
            {type === 'ADJUST' ? 'Change' : 'Quantity'}
            {product ? ` (${product.unit === 'unit' ? 'units' : product.unit})` : ''}
          </label>
          <input
            id="quantity"
            type="number"
            inputMode="decimal"
            step={product?.unit === 'unit' ? 1 : 'any'}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>

        {usesBatches && (
          <div className="field">
            <label htmlFor="batch">Batch{needsBatch ? '' : ' (optional)'}</label>
            <select id="batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} disabled={!product || batchList === null}>
              <option value="">{needsBatch ? 'Choose a batch…' : 'Earliest expiry first (automatic)'}</option>
              {batchList?.map((b) => (
                <option key={b.batchId} value={b.batchId}>
                  {b.batchId} · {product ? formatQuantity(b.remaining, product.unit) : b.remaining} left · expires {formatDate(b.expiryDate)}
                </option>
              ))}
            </select>
          </div>
        )}

        {type === 'RECEIVE' && (
          <div className="field">
            <label htmlFor="expiry">Expiry date (optional)</label>
            <input id="expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            <p className="hint">If left blank, the item's usual shelf life is used.</p>
          </div>
        )}

        <div className="field">
          <label htmlFor="reason">Reason{needsBatch ? '' : ' (optional)'}</label>
          <input id="reason" type="text" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>

        {error.length > 0 && (
          <div className="banner error" role="alert">
            {error.map((m, i) => (
              <p key={i}>{m}</p>
            ))}
          </div>
        )}
        {success && (
          <p className="banner ok" role="status">
            {success}
          </p>
        )}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Record movement'}
        </button>
      </form>
    </section>
  )
}
