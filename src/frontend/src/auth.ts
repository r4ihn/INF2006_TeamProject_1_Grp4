// Client-side session handling. The token is decoded only to show who is signed in and to hide
// controls the user's role cannot use; the API verifies the token and enforces every permission.

export type Role = 'staff' | 'manager'

export interface Session {
  token: string
  username: string
  role: Role
}

const KEY = 'cafestock.token'

export function parseToken(raw: string): Session | null {
  const token = raw.trim()
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')))
    const groups: unknown = payload['cognito:groups']
    const list = Array.isArray(groups) ? groups : []
    const role: Role | null = list.includes('manager') ? 'manager' : list.includes('staff') ? 'staff' : null
    if (!role) return null
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null
    return { token, username: String(payload.username ?? payload.sub ?? 'unknown'), role }
  } catch {
    return null
  }
}

// sessionStorage, not localStorage: the token is forgotten when the tab closes.
export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? parseToken(raw) : null
  } catch {
    return null
  }
}

export function saveSession(token: string): Session | null {
  const session = parseToken(token)
  if (session) {
    try {
      sessionStorage.setItem(KEY, session.token)
    } catch {
      // Storage unavailable: the session lasts until the page reloads.
    }
  }
  return session
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

export function getToken(): string | null {
  return loadSession()?.token ?? null
}
