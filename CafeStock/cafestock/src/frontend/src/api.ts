// API client. Every call goes through apiFetch(), which turns error responses into ApiError
// so pages can show the server's message (and per-field messages on forms).

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Sign-in hooks (set by AuthProvider) ─────────────────────────────────────
type TokenProvider = () => Promise<string | null>;
type UnauthorizedHandler = (error: ApiError) => Promise<boolean>;
let getToken: TokenProvider = async () => null;
let onUnauthorized: UnauthorizedHandler = async () => false;

/**
 * Called by AuthProvider: how to get the current access token, and what to do on a 401
 * (return true if the session was refreshed and the request should be retried once).
 */
export function configureApiAuth(opts: {
  getToken: TokenProvider;
  onUnauthorized: UnauthorizedHandler;
}) {
  getToken = opts.getToken;
  onUnauthorized = opts.onUnauthorized;
}

async function apiFetch<T>(path: string, init: RequestInit = {}, isRetry = false): Promise<T> {
  const token = path.startsWith('/api/') ? await getToken() : null;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Is `npm run dev` running?');
  }

  if (res.status === 204) return undefined as T;

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (
      body as { error?: { code?: string; message?: string; fields?: Record<string, string> } }
    )?.error;
    const fallback =
      res.status === 502 || res.status === 504
        ? 'The API is not responding (it may still be starting)'
        : `Request failed (HTTP ${res.status})`;
    const error = new ApiError(
      res.status,
      e?.code ?? 'HTTP_ERROR',
      e?.message ?? fallback,
      e?.fields,
    );
    if (res.status === 401 && !isRetry && (await onUnauthorized(error))) {
      return apiFetch<T>(path, init, true);
    }
    throw error;
  }
  return body as T;
}

// ─── Sign-in ───────────────────────────────────────────────────────────────

export interface AuthSettings {
  mode: 'cognito' | 'dev';
  region: string;
  userPoolId: string;
  clientId: string;
}

export type Role = 'STAFF' | 'MANAGER';

export interface Me {
  user: { id: string; email: string; name: string | null; role: Role };
  org: { id: string; name: string; slug: string; timezone: string };
}

export function getAuthSettings(signal?: AbortSignal): Promise<AuthSettings> {
  return apiFetch<AuthSettings>('/auth/config', { signal });
}

export function devLogin(
  role: 'staff' | 'manager',
): Promise<{ accessToken: string; expiresIn: number }> {
  return apiFetch('/auth/dev/login', { method: 'POST', body: JSON.stringify({ role }) });
}

export function getMe(signal?: AbortSignal): Promise<Me> {
  return apiFetch<Me>('/api/me', { signal });
}

// ─── Forecast (managers only) ──────────────────────────────────────────────

export interface ForecastRunSummary {
  id: string;
  /** What produced the forecasts, e.g. "lgbm-v1" or "baseline-ma14" */
  modelTag: string;
  modelKind: 'ML' | 'BASELINE';
  /** The ML model was wanted but couldn't be used, so the baseline ran */
  isFallback: boolean;
  /** The baseline it was compared with */
  baselineTag: string | null;
  /** First forecast day ("YYYY-MM-DD"); the history used ends the day before */
  forecastFrom: string;
  horizonDays: number;
  reviewDays: number;
  /** Recent weeks the errors were measured on */
  evalWeeks: number;
  serviceLevelZ: number;
  /** MASE: error ÷ error of "same day last week" (below 1 beats it) — ML model and baseline */
  maseModel: number | null;
  maseBaseline: number | null;
  mapeModel: number | null;
  mapeBaseline: number | null;
  modelUri: string | null;
  itemsProcessed: number;
  startedAt: string;
  finishedAt: string | null;
}

export function getLatestForecastRun(
  signal?: AbortSignal,
): Promise<{ run: ForecastRunSummary | null }> {
  return apiFetch('/api/forecast/latest-run', { signal });
}

export type RecommendationStatus = 'OK' | 'REORDER' | 'URGENT';

/** One item's reorder maths — every intermediate value, for "how this number was reached". */
export interface Recommendation {
  status: RecommendationStatus;
  onHand: number;
  leadTimeDays: number;
  avgDailyDemand: number;
  demandStdDev: number;
  leadTimeDemand: number;
  safetyStock: number;
  reorderPoint: number;
  shortfall: number;
  reviewDemand: number;
  orderUpTo: number;
  recommendedQty: number;
  spoilageCapApplied: boolean;
  coverDays: number | null;
  itemMase: number | null;
  itemMape: number | null;
  historyDays: number;
  notes: string[];
}

export interface ItemForecast {
  item: { id: string; name: string; unit: string; category: string };
  recommendation: Recommendation;
  forecast: { date: string; predicted: number; lower: number | null; upper: number | null }[];
  /** Actual demand for the 28 days before the forecast (days with none are 0) */
  history: { date: string; quantity: number }[];
}

export interface ForecastPayload {
  run: ForecastRunSummary | null;
  summary: { items: number; urgent: number; reorder: number; ok: number } | null;
  /** Most urgent first */
  items: ItemForecast[];
}

export function getLatestForecast(signal?: AbortSignal): Promise<ForecastPayload> {
  return apiFetch('/api/forecast/latest', { signal });
}

// ─── Health ────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok';
  service: string;
  uptimeSeconds: number;
  timestamp: string;
}

export interface ReadinessResponse {
  status: 'ok';
  database: 'up';
  latencyMs: number;
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health', { signal });
}

/**
 * Resolves when the API can reach the database and its tables exist; otherwise rejects
 * with a readable reason (code NETWORK / DB_DOWN / TABLES_MISSING / HTTP_ERROR).
 */
export async function fetchReadiness(signal?: AbortSignal): Promise<ReadinessResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/health/ready`, {
      signal,
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Is `npm run dev` running?');
  }
  const body = (await res.json().catch(() => null)) as { tables?: string } | null;
  if (res.ok) return body as ReadinessResponse;
  if (res.status === 503 && body?.tables === 'missing') {
    throw new ApiError(
      503,
      'TABLES_MISSING',
      'The database is running, but its tables are missing',
    );
  }
  if (res.status === 503) throw new ApiError(503, 'DB_DOWN', 'The API cannot reach the database');
  throw new ApiError(
    res.status,
    'HTTP_ERROR',
    res.status === 502 || res.status === 504
      ? 'The API is not responding (it may still be starting)'
      : `Readiness check failed (HTTP ${res.status})`,
  );
}

// ─── Suppliers ─────────────────────────────────────────────────────────────

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  leadTimeDays: number;
  notes: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

/** What the form sends. Empty optional fields are sent as "" and stored as null. */
export interface SupplierInput {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  leadTimeDays: number;
  notes: string;
}

export function listSuppliers(signal?: AbortSignal): Promise<Supplier[]> {
  return apiFetch<Supplier[]>('/api/suppliers', { signal });
}

export function createSupplier(input: SupplierInput): Promise<Supplier> {
  return apiFetch<Supplier>('/api/suppliers', { method: 'POST', body: JSON.stringify(input) });
}

export function updateSupplier(id: string, input: Partial<SupplierInput>): Promise<Supplier> {
  return apiFetch<Supplier>(`/api/suppliers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteSupplier(id: string): Promise<void> {
  return apiFetch<void>(`/api/suppliers/${id}`, { method: 'DELETE' });
}

// ─── Items ─────────────────────────────────────────────────────────────────

export interface Item {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  unit: string;
  unitCost: number;
  onHand: number;
  reorderPoint: number;
  spoilageCap: number | null;
  isActive: boolean;
  /** On hand is at or below the reorder point */
  isLow: boolean;
  supplier: { id: string; name: string; leadTimeDays: number } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ItemInput {
  name: string;
  sku: string;
  category: string;
  unit: string;
  /** "" = no supplier */
  supplierId: string;
  unitCost: number;
  reorderPoint: number;
  spoilageCap: number | null;
}

/** All items, including archived ones (the page filters locally). */
export function listItems(signal?: AbortSignal): Promise<Item[]> {
  return apiFetch<Item[]>('/api/items?includeArchived=true', { signal });
}

export function listItemCategories(signal?: AbortSignal): Promise<string[]> {
  return apiFetch<string[]>('/api/items/categories', { signal });
}

export function createItem(input: ItemInput): Promise<Item> {
  return apiFetch<Item>('/api/items', { method: 'POST', body: JSON.stringify(input) });
}

export function updateItem(
  id: string,
  input: Partial<ItemInput> & { isActive?: boolean },
): Promise<Item> {
  return apiFetch<Item>(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteItem(id: string): Promise<void> {
  return apiFetch<void>(`/api/items/${id}`, { method: 'DELETE' });
}

// ─── Stock ─────────────────────────────────────────────────────────────────

export type MovementType = 'RECEIVE' | 'USAGE' | 'WASTE' | 'ADJUSTMENT' | 'COUNT';

export interface StockItemSummary {
  id: string;
  name: string;
  unit: string;
  onHand: number;
  isLow: boolean;
}

export interface StockChangeResult {
  movementId: string;
  itemId: string;
  type: MovementType;
  before: number;
  change: number;
  after: number;
  /** How much of this change was recorded as demand (usage) */
  demandRecorded: number;
  demandDate: string | null;
  item: StockItemSummary;
}

export interface MovementInput {
  itemId: string;
  type: Exclude<MovementType, 'COUNT'>;
  /** Positive amount; for ADJUSTMENT, negative removes stock */
  quantity: number;
  note?: string;
  /** ISO date-time; omit for "now" */
  occurredAt?: string;
}

export interface CountInput {
  counts: { itemId: string; counted: number }[];
  note?: string;
  occurredAt?: string;
}

export interface Movement {
  id: string;
  type: MovementType;
  quantityChange: number;
  quantityAfter: number;
  note: string | null;
  occurredAt: string;
  createdAt: string;
  item: { id: string; name: string; unit: string };
  /** Who recorded it (null for imported rows and changes made before sign-in existed) */
  createdBy: { email: string; displayName: string | null } | null;
  /** Came from a dataset's stock ledger rather than being recorded in the app */
  imported: boolean;
}

export interface DemandSeries {
  itemId: string;
  unit: string;
  from: string;
  to: string;
  total: number;
  averagePerDay: number;
  days: { date: string; quantity: number }[];
}

export function recordMovement(input: MovementInput): Promise<StockChangeResult> {
  return apiFetch('/api/stock/movements', { method: 'POST', body: JSON.stringify(input) });
}

export function recordCount(
  input: CountInput,
): Promise<{ counted: number; changes: StockChangeResult[] }> {
  return apiFetch('/api/stock/counts', { method: 'POST', body: JSON.stringify(input) });
}

export function listMovements(
  filters: { itemId?: string; type?: MovementType; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Movement[]> {
  const qs = new URLSearchParams();
  if (filters.itemId) qs.set('itemId', filters.itemId);
  if (filters.type) qs.set('type', filters.type);
  qs.set('limit', String(filters.limit ?? 50));
  return apiFetch(`/api/stock/movements?${qs}`, { signal });
}

/** Daily demand for `days` days ending on `to` (default: today). */
export function getDemand(
  itemId: string,
  days = 14,
  signal?: AbortSignal,
  to?: string,
): Promise<DemandSeries> {
  const qs = new URLSearchParams({ itemId, days: String(days) });
  if (to) qs.set('to', to);
  return apiFetch(`/api/stock/demand?${qs}`, { signal });
}

// ─── Demand history & dataset imports ──────────────────────────────────────

export interface ItemHistory {
  itemId: string;
  name: string;
  unit: string;
  category: string;
  isActive: boolean;
  onHand: number;
  days: number;
  /** Days that came from an imported dataset / were recorded in the app */
  importedDays: number;
  recordedDays: number;
  /** Days with zero demand */
  zeroDays: number;
  firstDate: string;
  lastDate: string;
  total: number;
  averagePerDay: number;
}

export function getHistory(signal?: AbortSignal): Promise<ItemHistory[]> {
  return apiFetch('/api/stock/history', { signal });
}

export interface ImportedFile {
  role: 'ingredients' | 'demand' | 'ledger';
  file: string;
  rows: number;
  sha256: string;
  columns: string[];
}

/** One run of `npm run db:import` — where the data came from and what it changed. */
export interface DatasetImport {
  id: string;
  source: string;
  files: ImportedFile[];
  itemCount: number;
  dayCount: number;
  dateFrom: string;
  dateTo: string;
  /** Days every date was moved forward (0 = the dataset's real dates) */
  dateShiftDays: number;
  itemsCreated: number;
  demandInserted: number;
  demandUpdated: number;
  demandUnchanged: number;
  demandSkipped: number;
  movementsInserted: number;
  ledgerItemsSkipped: number;
  replaced: boolean;
  importedAt: string;
}

export function listImports(signal?: AbortSignal): Promise<DatasetImport[]> {
  return apiFetch('/api/imports', { signal });
}

// ─── Staff scheduling ──────────────────────────────────────────────────────

export interface Shift {
  id: string;
  /** Café-local day and times; end "24:00" = midnight at the end of the day */
  date: string;
  start: string;
  end: string;
  startsAt: string;
  endsAt: string;
  hours: number;
  position: string;
  note: string | null;
  /** null = open shift (nobody assigned yet) */
  assignee: { id: string; name: string; onRoster: boolean } | null;
}

export interface PersonHours {
  userId: string;
  name: string;
  onRoster: boolean;
  shifts: number;
  hours: number;
}

export interface ShiftsPayload {
  from: string;
  to: string;
  days: number;
  timezone: string;
  /** Planned hours above this in a week are flagged */
  weeklyHoursLimit: number;
  totals: { shifts: number; hours: number; open: number };
  shifts: Shift[];
  /** Managers: hours per person (everyone on the roster). Staff: empty. */
  people: PersonHours[];
}

export interface ShiftInput {
  date: string;
  start: string;
  end: string;
  position: string;
  /** "" or null = open shift */
  userId: string | null;
  note: string;
}

export interface CopyWeekResult {
  from: string;
  to: string;
  sourceCount: number;
  copied: number;
  /** Shifts of people no longer on the roster, copied as open shifts */
  opened: number;
  skipped: { date: string; start: string; end: string; name: string; reason: string }[];
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Has signed in at least once */
  signedIn: boolean;
  onRoster: boolean;
  isYou: boolean;
}

export function listShifts(from: string, signal?: AbortSignal, days = 7): Promise<ShiftsPayload> {
  return apiFetch(`/api/shifts?${new URLSearchParams({ from, days: String(days) })}`, { signal });
}

export function createShift(input: ShiftInput): Promise<Shift> {
  return apiFetch('/api/shifts', { method: 'POST', body: JSON.stringify(input) });
}

export function updateShift(id: string, input: Partial<ShiftInput>): Promise<Shift> {
  return apiFetch(`/api/shifts/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteShift(id: string): Promise<void> {
  return apiFetch(`/api/shifts/${id}`, { method: 'DELETE' });
}

export function copyWeek(from: string): Promise<CopyWeekResult> {
  return apiFetch('/api/shifts/copy-week', { method: 'POST', body: JSON.stringify({ from }) });
}

export function listTeam(signal?: AbortSignal): Promise<TeamMember[]> {
  return apiFetch('/api/team', { signal });
}

export function addTeamMember(input: { name: string; email: string }): Promise<TeamMember> {
  return apiFetch('/api/team', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTeamMember(
  id: string,
  input: { name?: string; onRoster?: boolean },
): Promise<TeamMember & { openedShifts: number }> {
  return apiFetch(`/api/team/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}
