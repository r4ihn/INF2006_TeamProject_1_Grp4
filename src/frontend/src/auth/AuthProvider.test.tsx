// The real AuthProvider + App against fake /auth, /api and Cognito endpoints.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { fakeJwt, jsonResponse, renderWithProviders } from '../test/render';

const DEV_SETTINGS = {
  mode: 'dev',
  region: 'lo-local-1',
  userPoolId: 'lo-local-1_CafeStockDev',
  clientId: 'cafestock-dev-client',
};
const COGNITO_SETTINGS = {
  mode: 'cognito',
  region: 'us-east-1',
  userPoolId: 'us-east-1_Pool1',
  clientId: 'client-123',
};
const COGNITO_URL = 'https://cognito-idp.us-east-1.amazonaws.com/';

const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;
const ME = (role: 'STAFF' | 'MANAGER') => ({
  user: {
    id: 'u1',
    email: role === 'MANAGER' ? 'manager@demo.cafe' : 'staff@demo.cafe',
    name: role === 'MANAGER' ? 'Mia (manager)' : 'Sam (staff)',
    role,
  },
  org: { id: 'o1', name: 'Demo Café', slug: 'demo-cafe', timezone: 'Asia/Singapore' },
});

type Handler = (init: RequestInit) => Response | Promise<Response>;

/** fetch stand-in: route by URL (+ X-Amz-Target for Cognito); unknown /api calls → []. */
function installFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const target = (init.headers as Record<string, string> | undefined)?.['X-Amz-Target'];
    const key = target ? `${url} ${target.split('.').pop()}` : url.split('?')[0]!;
    const handler = routes[key];
    if (handler) return handler(init);
    if (url.startsWith('/api/')) return jsonResponse([]);
    throw new Error(`Unexpected fetch: ${key}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const authHeader = (init?: RequestInit) =>
  (init?.headers as Record<string, string> | undefined)?.Authorization;
const renderApp = (route = '/') => renderWithProviders(<App />, { route, realAuth: true });

afterEach(() => sessionStorage.clear());

describe('development sign-in', () => {
  it('signs in as manager and sends the token with API calls', async () => {
    const token = fakeJwt({ sub: 'dev-manager', exp: inAnHour() });
    const fetchMock = installFetch({
      '/auth/config': () => jsonResponse(DEV_SETTINGS),
      '/auth/dev/login': () => jsonResponse({ accessToken: token, expiresIn: 3600 }),
      '/api/me': () => jsonResponse(ME('MANAGER')),
    });
    const user = userEvent.setup();
    renderApp();

    expect(await screen.findByText(/Development sign-in/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Continue as manager/ }));

    expect(await screen.findByText('Mia (manager)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forecast' })).toBeInTheDocument();
    expect(screen.getByText('Manager')).toBeInTheDocument();
    const meCall = fetchMock.mock.calls.find(([url]) => url === '/api/me');
    expect(authHeader(meCall?.[1])).toBe(`Bearer ${token}`);
    expect(JSON.parse(sessionStorage.getItem('cafestock.session')!)).toMatchObject({
      mode: 'dev',
      accessToken: token,
    });
  });

  it('staff don’t get the Forecast tab', async () => {
    installFetch({
      '/auth/config': () => jsonResponse(DEV_SETTINGS),
      '/auth/dev/login': () =>
        jsonResponse({ accessToken: fakeJwt({ exp: inAnHour() }), expiresIn: 3600 }),
      '/api/me': () => jsonResponse(ME('STAFF')),
    });
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: /Continue as staff/ }));

    expect(await screen.findByText('Sam (staff)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Forecast' })).not.toBeInTheDocument();
  });

  it('stays signed in after a page reload', async () => {
    sessionStorage.setItem(
      'cafestock.session',
      JSON.stringify({
        id: 's1',
        mode: 'dev',
        accessToken: fakeJwt({ exp: inAnHour() }),
        expiresAt: inAnHour() * 1000,
      }),
    );
    installFetch({
      '/auth/config': () => jsonResponse(DEV_SETTINGS),
      '/api/me': () => jsonResponse(ME('MANAGER')),
    });
    renderApp();
    expect(await screen.findByText('Mia (manager)')).toBeInTheDocument();
  });

  it('signs out when the session has expired', async () => {
    sessionStorage.setItem(
      'cafestock.session',
      JSON.stringify({ id: 's1', mode: 'dev', accessToken: 'old', expiresAt: inAnHour() * 1000 }),
    );
    installFetch({
      '/auth/config': () => jsonResponse(DEV_SETTINGS),
      '/api/me': () =>
        jsonResponse({ error: { code: 'SESSION_EXPIRED', message: 'expired' } }, 401),
    });
    renderApp();
    expect(
      await screen.findByText('Your session has expired. Please sign in again.'),
    ).toBeInTheDocument();
    expect(sessionStorage.getItem('cafestock.session')).toBeNull();
  });

  it('explains an account with no role', async () => {
    installFetch({
      '/auth/config': () => jsonResponse(DEV_SETTINGS),
      '/auth/dev/login': () =>
        jsonResponse({ accessToken: fakeJwt({ exp: inAnHour() }), expiresIn: 3600 }),
      '/api/me': () =>
        jsonResponse({ error: { code: 'NO_ROLE', message: 'Your account has no role yet.' } }, 403),
    });
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: /Continue as staff/ }));
    expect(await screen.findByText('Your account has no role yet.')).toBeInTheDocument();
  });

  it('signs out', async () => {
    installFetch({
      '/auth/config': () => jsonResponse(DEV_SETTINGS),
      '/auth/dev/login': () =>
        jsonResponse({ accessToken: fakeJwt({ exp: inAnHour() }), expiresIn: 3600 }),
      '/api/me': () => jsonResponse(ME('MANAGER')),
    });
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: /Continue as manager/ }));
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('button', { name: /Continue as manager/ })).toBeInTheDocument();
    expect(sessionStorage.getItem('cafestock.session')).toBeNull();
  });

  it('says so when the server can’t be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderApp();
    expect(await screen.findByText(/Can’t reach the server/)).toBeInTheDocument();
  });

  it('keeps System status reachable while signed out', async () => {
    installFetch({ '/auth/config': () => jsonResponse(DEV_SETTINGS) });
    renderApp('/status');
    expect(await screen.findByRole('heading', { name: 'System status' })).toBeInTheDocument();
  });
});

describe('Cognito sign-in', () => {
  // one expiry for the whole test, so tokens() gives the same token each time it's called
  // (calling inAnHour() per token made the test fail when a second ticked over in between)
  let exp = inAnHour();
  beforeEach(() => {
    exp = inAnHour();
  });
  const tokens = (n = 1) => ({
    AuthenticationResult: {
      AccessToken: fakeJwt({ sub: 'abc', exp, n }),
      RefreshToken: 'refresh-1',
      ExpiresIn: 3600,
      TokenType: 'Bearer',
    },
  });

  it('signs in with email and password', async () => {
    const fetchMock = installFetch({
      '/auth/config': () => jsonResponse(COGNITO_SETTINGS),
      [`${COGNITO_URL} InitiateAuth`]: () => jsonResponse(tokens()),
      '/api/me': () => jsonResponse(ME('STAFF')),
    });
    const user = userEvent.setup();
    renderApp();

    expect(
      await screen.findByText(
        'Forgot your password? Ask the café owner to inform IT admin to change it.',
      ),
    ).toBeInTheDocument();
    await user.type(await screen.findByLabelText('Email'), ' amy@demo.cafe ');
    await user.type(screen.getByLabelText('Password'), 'Correct horse 1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Sam (staff)')).toBeInTheDocument();
    const cognitoCall = fetchMock.mock.calls.find(([url]) => url === COGNITO_URL)!;
    expect(JSON.parse(String(cognitoCall[1]!.body))).toEqual({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: 'client-123',
      AuthParameters: { USERNAME: 'amy@demo.cafe', PASSWORD: 'Correct horse 1' },
    });
    const meCall = fetchMock.mock.calls.find(([url]) => url === '/api/me');
    expect(authHeader(meCall?.[1])).toBe(`Bearer ${tokens().AuthenticationResult.AccessToken}`);
  });

  it('shows a clear message for a wrong password', async () => {
    installFetch({
      '/auth/config': () => jsonResponse(COGNITO_SETTINGS),
      [`${COGNITO_URL} InitiateAuth`]: () =>
        jsonResponse(
          { __type: 'NotAuthorizedException', message: 'Incorrect username or password.' },
          400,
        ),
    });
    const user = userEvent.setup();
    renderApp();
    await user.type(await screen.findByLabelText('Email'), 'amy@demo.cafe');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
  });

  it('asks a new user to choose their own password', async () => {
    const fetchMock = installFetch({
      '/auth/config': () => jsonResponse(COGNITO_SETTINGS),
      [`${COGNITO_URL} InitiateAuth`]: () =>
        jsonResponse({
          ChallengeName: 'NEW_PASSWORD_REQUIRED',
          Session: 'challenge-session',
          ChallengeParameters: { USER_ID_FOR_SRP: 'abc-sub' },
        }),
      [`${COGNITO_URL} RespondToAuthChallenge`]: () => jsonResponse(tokens()),
      '/api/me': () => jsonResponse(ME('MANAGER')),
    });
    const user = userEvent.setup();
    renderApp();
    await user.type(await screen.findByLabelText('Email'), 'new@demo.cafe');
    await user.type(screen.getByLabelText('Password'), 'Temp1234567');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await user.type(await screen.findByLabelText('New password'), 'short1');
    await user.type(screen.getByLabelText('Confirm new password'), 'short1');
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }));
    expect(screen.getByText(/at least 10 characters/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('New password'));
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('New password'), 'mynewpassword9');
    await user.type(screen.getByLabelText('Confirm new password'), 'mynewpassword9');
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }));

    expect(await screen.findByText('Mia (manager)')).toBeInTheDocument();
    const respond = fetchMock.mock.calls.find(([, init]) =>
      (init?.headers as Record<string, string>)?.['X-Amz-Target']?.endsWith(
        'RespondToAuthChallenge',
      ),
    )!;
    expect(JSON.parse(String(respond[1]!.body))).toEqual({
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      ClientId: 'client-123',
      Session: 'challenge-session',
      ChallengeResponses: { USERNAME: 'abc-sub', NEW_PASSWORD: 'mynewpassword9' },
    });
  });

  it('refreshes an access token that is about to expire, then uses the new one', async () => {
    sessionStorage.setItem(
      'cafestock.session',
      JSON.stringify({
        id: 's1',
        mode: 'cognito',
        accessToken: 'nearly-expired',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() + 10_000, // < 1 minute left
      }),
    );
    const fresh = tokens(2).AuthenticationResult;
    const fetchMock = installFetch({
      '/auth/config': () => jsonResponse(COGNITO_SETTINGS),
      [`${COGNITO_URL} InitiateAuth`]: () =>
        jsonResponse({ AuthenticationResult: { ...fresh, RefreshToken: undefined } }),
      '/api/me': () => jsonResponse(ME('MANAGER')),
    });
    renderApp();

    expect(await screen.findByText('Mia (manager)')).toBeInTheDocument();
    const refresh = fetchMock.mock.calls.find(([url]) => url === COGNITO_URL)!;
    expect(JSON.parse(String(refresh[1]!.body))).toMatchObject({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: { REFRESH_TOKEN: 'refresh-1' },
    });
    const meCall = fetchMock.mock.calls.find(([url]) => url === '/api/me');
    expect(authHeader(meCall?.[1])).toBe(`Bearer ${fresh.AccessToken}`);
    // The refresh token is kept (Cognito doesn't send a new one on refresh)
    expect(JSON.parse(sessionStorage.getItem('cafestock.session')!).refreshToken).toBe('refresh-1');
  });

  it('revokes the refresh token on sign-out', async () => {
    const fetchMock = installFetch({
      '/auth/config': () => jsonResponse(COGNITO_SETTINGS),
      [`${COGNITO_URL} InitiateAuth`]: () => jsonResponse(tokens()),
      [`${COGNITO_URL} RevokeToken`]: () => jsonResponse({}),
      '/api/me': () => jsonResponse(ME('STAFF')),
    });
    const user = userEvent.setup();
    renderApp();
    await user.type(await screen.findByLabelText('Email'), 'amy@demo.cafe');
    await user.type(screen.getByLabelText('Password'), 'Correct horse 1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) =>
          (init?.headers as Record<string, string>)?.['X-Amz-Target']?.endsWith('RevokeToken'),
        ),
      ).toBe(true),
    );
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  });
});
