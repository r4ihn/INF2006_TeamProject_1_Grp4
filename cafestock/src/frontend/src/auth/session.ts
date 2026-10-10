// Where the signed-in session lives between page loads.
// sessionStorage: survives a refresh, cleared when the tab is closed. Wrapped in try/catch
// because storage can be unavailable (private windows, blocked site data).

export interface StoredSession {
  /** Random id for this sign-in (kept across token refreshes) */
  id: string;
  mode: 'cognito' | 'dev';
  accessToken: string;
  refreshToken?: string;
  /** ms since epoch */
  expiresAt: number;
}

const KEY = 'cafestock.session';

export function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    return s.id && s.accessToken && s.expiresAt ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession | null): void {
  try {
    if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage unavailable — the session just won't survive a page refresh
  }
}

/** Expiry time (ms) from a JWT's `exp` claim, falling back to `expiresIn` seconds. */
export function expiryOf(accessToken: string, expiresInSeconds: number): number {
  try {
    const payload = JSON.parse(
      atob(accessToken.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')),
    );
    if (typeof payload.exp === 'number') return payload.exp * 1000;
  } catch {
    // not a readable JWT — use expiresIn
  }
  return Date.now() + expiresInSeconds * 1000;
}

export function newSessionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
