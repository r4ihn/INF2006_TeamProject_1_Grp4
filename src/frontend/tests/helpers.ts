import { vi } from 'vitest'
import type { Batch, Movement, StockItem } from '../src/api.ts'

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// An unsigned JWT-shaped string. The UI only reads the claims; the API verifies the signature.
export function makeToken(role: 'staff' | 'manager', extra: object = {}): string {
  const payload = {
    sub: `${role}-1`,
    username: `test-${role}`,
    'cognito:groups': [role],
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...extra,
  }
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`
}

export const milk: StockItem = {
  productId: 1,
  sku: 'ING-002',
  name: 'Fresh milk',
  unit: 'ml',
  storageLocation: 'Chiller',
  onHand: 5700,
  reorderThreshold: 3120,
  reorderQuantity: 4000,
  isLow: false,
  earliestExpiry: '2025-03-25',
  expiredQuantity: 5700,
}

export const napkins: StockItem = {
  productId: 2,
  sku: 'ING-008',
  name: 'Napkin',
  unit: 'unit',
  storageLocation: 'Dry Store 2',
  onHand: 65,
  reorderThreshold: 125,
  reorderQuantity: 250,
  isLow: true,
  earliestExpiry: '2027-03-08',
  expiredQuantity: 0,
}

export const batches: Batch[] = [
  { batchId: 'B000242', expiryDate: '2027-03-08', storageLocation: 'Dry Store 2', remaining: 65 },
]

export const movement = (over: Partial<Movement> = {}): Movement => ({
  movementId: 1,
  occurredAt: '2026-09-30T10:00:00.000Z',
  productId: 2,
  movementType: 'SELL',
  quantity: -5,
  batchId: 'B000242',
  expiryDate: '2027-03-08',
  storageLocation: 'Dry Store 2',
  reason: null,
  source: 'app',
  recordedBy: 'test-staff',
  ...over,
})

type Handler = (req: { body: unknown }) => { status?: number; body: unknown }

export interface FetchMock {
  calls: { method: string; path: string; body: unknown; auth: string | null }[]
  count: (method: string, path: string) => number
}

// Route table keyed by "METHOD /path" (query string ignored). Unknown routes return 404.
export function mockFetch(routes: Record<string, Handler>): FetchMock {
  const mock: FetchMock = {
    calls: [],
    count: (method, path) => mock.calls.filter((c) => c.method === method && c.path === path).length,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase()
      const path = new URL(url).pathname
      const body = init.body ? JSON.parse(init.body as string) : undefined
      const auth = new Headers(init.headers).get('Authorization')
      mock.calls.push({ method, path, body, auth })
      const handler = routes[`${method} ${path}`]
      const res = handler ? handler({ body }) : { status: 404, body: { error: 'NOT_FOUND', message: 'nope' } }
      return new Response(JSON.stringify(res.body), {
        status: res.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  return mock
}
