import { getToken } from './auth.ts'

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export type MovementType = 'RECEIVE' | 'SELL' | 'SPOILAGE' | 'ADJUST'

export interface StockItem {
  productId: number
  sku: string
  name: string
  unit: 'g' | 'ml' | 'unit'
  storageLocation: string | null
  onHand: number
  reorderThreshold: number
  reorderQuantity: number
  isLow: boolean
  earliestExpiry: string | null
  expiredQuantity: number
}

export interface Movement {
  movementId: number
  occurredAt: string
  productId: number
  movementType: MovementType
  quantity: number
  batchId: string
  expiryDate: string | null
  storageLocation: string | null
  reason: string | null
  source: 'derived' | 'synthetic' | 'app'
  recordedBy: string | null
}

export interface Batch {
  batchId: string
  expiryDate: string | null
  storageLocation: string | null
  remaining: number
}

export interface NewMovement {
  productId: number
  movementType: MovementType
  quantity: number
  batchId?: string
  expiryDate?: string
  reason?: string
}

export interface MovementResult {
  movements: Movement[]
  onHand: number
}

export interface OrderSuggestion {
  packs: number
  units: number
  cappedByShelfLife: boolean
  weeksOfCover: number | null
}

export interface Recommendation {
  productId: number
  sku: string
  name: string
  unit: 'g' | 'ml' | 'unit'
  packSize: number
  packDescription: string | null
  onHand: number
  expiredQuantity: number
  forecastNextWeek: number
  safetyStock: number
  // Backtest error of the method for this item relative to "same as last week" (1.0); lower is better.
  methodMase: number | null
  stockAtRun: number
  published: OrderSuggestion
  suggested: OrderSuggestion
}

interface Outcome {
  serviceLevel: number
  stockoutDays: number
}

export interface ForecastRun {
  runId: number
  method: string
  asOf: string
  serviceZ: number
  coverWeeks: number
  source: string
  evaluation: {
    accuracy?: { method: string; mase: number; baselineMethod: string; baselineMase: number }
    simulatedYear?: { serviceZ: number; withoutForecast: Outcome | null; withForecast: Outcome | null }
  }
}

export interface RecommendationsResponse {
  run: ForecastRun | null
  items: Recommendation[]
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

let onUnauthorized: () => void = () => {}

// Called when the API rejects the token (401), so the app can return to the sign-in screen.
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body) headers.set('Content-Type', 'application/json')

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check that the API is running.')
  }

  const body = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401) onUnauthorized()
    throw new ApiError(
      res.status,
      body?.error ?? 'ERROR',
      body?.message ?? `Request failed (${res.status})`,
      body?.details,
    )
  }
  return body as T
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  stock: () => request<StockItem[]>('/stock'),
  batches: (productId: number) => request<Batch[]>(`/products/${productId}/batches`),
  movements: (opts: { limit?: number; beforeId?: number } = {}) => {
    const q = new URLSearchParams()
    if (opts.limit) q.set('limit', String(opts.limit))
    if (opts.beforeId) q.set('beforeId', String(opts.beforeId))
    return request<Movement[]>(`/movements?${q}`)
  },
  recommendations: () => request<RecommendationsResponse>('/recommendations'),
  record: (m: NewMovement) =>
    request<MovementResult>('/movements', { method: 'POST', body: JSON.stringify(m) }),
}
