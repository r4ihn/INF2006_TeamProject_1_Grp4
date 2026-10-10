import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { AuthContext, type AuthState } from '../auth/context';
import type { Role } from '../api';

/** A signed-in user for page tests that aren't about signing in. */
export function signedInAs(role: Role = 'MANAGER', overrides: Partial<AuthState> = {}): AuthState {
  const manager = role === 'MANAGER';
  return {
    status: 'signed-in',
    settings: { mode: 'dev', region: 'lo-local-1', userPoolId: 'lo-local-1_X', clientId: 'c' },
    settingsError: null,
    me: {
      user: {
        id: manager ? 'u-manager' : 'u-staff',
        email: manager ? 'manager@demo.cafe' : 'staff@demo.cafe',
        name: manager ? 'Mia (manager)' : 'Sam (staff)',
        role,
      },
      org: { id: 'org-1', name: 'Demo Café', slug: 'demo-cafe', timezone: 'Asia/Singapore' },
    },
    message: null,
    signInDev: vi.fn(),
    signInCognito: vi.fn(),
    completeNewPassword: vi.fn(),
    signOut: vi.fn(async () => {}),
    ...overrides,
  };
}

/**
 * Renders UI with the same providers as main.tsx: router at `route`, fresh query cache, and
 * either a fake signed-in user (default) or the real AuthProvider (`realAuth: true`).
 */
export function renderWithProviders(
  ui: ReactElement,
  {
    route = '/',
    auth = signedInAs('MANAGER'),
    realAuth = false,
  }: { route?: string; auth?: AuthState; realAuth?: boolean } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const withAuth = (children: ReactNode) =>
    realAuth ? (
      <AuthProvider>{children}</AuthProvider>
    ) : (
      <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
    );
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{withAuth(ui)}</MemoryRouter>
    </QueryClientProvider>,
  );
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** An unsigned JWT-shaped string with the given claims (the browser only reads `exp`). */
export function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.signature`;
}
