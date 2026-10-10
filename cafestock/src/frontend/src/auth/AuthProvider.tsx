import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  configureApiAuth,
  devLogin,
  getAuthSettings,
  getMe,
  type AuthSettings,
  type Me,
} from '../api';
import * as cognito from './cognito';
import { AuthContext, type AuthState, type NewPasswordChallenge } from './context';
import { expiryOf, loadSession, newSessionId, saveSession, type StoredSession } from './session';

const REFRESH_EARLY_MS = 60_000; // refresh a minute before the access token expires

/**
 * Owns the sign-in session: loads how to sign in (/auth/config), keeps the tokens, refreshes
 * them before they expire, gives the API client the current token, and signs out on a 401
 * that refreshing can't fix. The sign-in status is derived from that state, never stored.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<AuthSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  // Who's signed in, remembered per session (a token refresh keeps the same session id)
  const [profile, setProfile] = useState<{ sessionId: string; me: Me } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // A stored session from the other sign-in mode (server switched dev ↔ Cognito) is ignored
  const usable = settings && session && session.mode === settings.mode ? session : null;
  const me = usable && profile?.sessionId === usable.id ? profile.me : null;
  const status: AuthState['status'] = settingsError
    ? 'error'
    : !settings
      ? 'loading'
      : !usable
        ? 'signed-out'
        : me
          ? 'signed-in'
          : 'loading';

  // Refs let the API hooks read the latest values without re-registering
  const sessionRef = useRef(session);
  const settingsRef = useRef(settings);
  const refreshing = useRef<Promise<StoredSession | null> | null>(null);
  useEffect(() => {
    sessionRef.current = session;
    settingsRef.current = settings;
  }, [session, settings]);

  const store = useCallback((next: StoredSession | null) => {
    sessionRef.current = next;
    saveSession(next);
    setSession(next);
  }, []);

  const signOut = useCallback(
    async (reason?: string) => {
      const s = sessionRef.current;
      const cfg = settingsRef.current;
      store(null);
      setProfile(null);
      setMessage(reason ?? null);
      queryClient.clear(); // don't leave the previous user's data in the cache
      if (s?.mode === 'cognito' && s.refreshToken && cfg) {
        await cognito.revoke(cfg, s.refreshToken);
      }
    },
    [queryClient, store],
  );

  /** New access token via the refresh token (Cognito only). One refresh at a time. */
  const refreshSession = useCallback(async (): Promise<StoredSession | null> => {
    const s = sessionRef.current;
    const cfg = settingsRef.current;
    if (!s || s.mode !== 'cognito' || !s.refreshToken || !cfg) return null;
    refreshing.current ??= cognito
      .refresh(cfg, s.refreshToken)
      .then((t) => {
        const next: StoredSession = {
          ...s,
          accessToken: t.accessToken,
          refreshToken: t.refreshToken,
          expiresAt: expiryOf(t.accessToken, t.expiresIn),
        };
        store(next);
        return next;
      })
      .catch(() => null)
      .finally(() => {
        refreshing.current = null;
      });
    return refreshing.current;
  }, [store]);

  // Give the API client its token source and 401 handling
  useEffect(() => {
    configureApiAuth({
      getToken: async () => {
        const s = sessionRef.current;
        if (!s) return null;
        if (s.expiresAt - Date.now() < REFRESH_EARLY_MS) {
          const fresh = await refreshSession();
          if (fresh) return fresh.accessToken;
        }
        return s.accessToken;
      },
      onUnauthorized: async (error: ApiError) => {
        if (!sessionRef.current) return false;
        if (await refreshSession()) return true; // retry the request once
        await signOut(
          error.code === 'SESSION_EXPIRED'
            ? 'Your session has expired. Please sign in again.'
            : 'Please sign in again.',
        );
        return false;
      },
    });
  }, [refreshSession, signOut]);

  // How do we sign in here?
  useEffect(() => {
    const controller = new AbortController();
    getAuthSettings(controller.signal)
      .then(setSettings)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setSettingsError(
          err instanceof ApiError && err.status !== 0
            ? err.message
            : 'Can’t reach the server. Is `npm run dev` running?',
        );
      });
    return () => controller.abort();
  }, []);

  // With a session: who am I? (This also checks the stored token is still good.)
  const usableId = usable?.id;
  const profileId = profile?.sessionId;
  useEffect(() => {
    if (!usableId || profileId === usableId) return;
    const controller = new AbortController();
    getMe(controller.signal)
      .then((m) => {
        setProfile({ sessionId: usableId, me: m });
        setMessage(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) return; // onUnauthorized handled it
        void signOut(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.');
      });
    return () => controller.abort();
  }, [usableId, profileId, signOut]);

  const value = useMemo<AuthState>(() => {
    const start = (s: Omit<StoredSession, 'id'>) => {
      setMessage(null);
      store({ ...s, id: newSessionId() });
    };
    return {
      status,
      settings,
      settingsError,
      me,
      message,
      signInDev: async (role) => {
        const r = await devLogin(role);
        start({
          mode: 'dev',
          accessToken: r.accessToken,
          expiresAt: expiryOf(r.accessToken, r.expiresIn),
        });
      },
      signInCognito: async (email, password) => {
        if (!settings) throw new Error('Sign-in settings not loaded');
        const r = await cognito.signIn(settings, email.trim(), password);
        if (r.kind === 'new-password-required') {
          return { session: r.session, username: r.username } satisfies NewPasswordChallenge;
        }
        start({
          mode: 'cognito',
          accessToken: r.tokens.accessToken,
          refreshToken: r.tokens.refreshToken,
          expiresAt: expiryOf(r.tokens.accessToken, r.tokens.expiresIn),
        });
        return null;
      },
      completeNewPassword: async (challenge, newPassword) => {
        if (!settings) throw new Error('Sign-in settings not loaded');
        const t = await cognito.completeNewPassword(
          settings,
          challenge.session,
          challenge.username,
          newPassword,
        );
        start({
          mode: 'cognito',
          accessToken: t.accessToken,
          refreshToken: t.refreshToken,
          expiresAt: expiryOf(t.accessToken, t.expiresIn),
        });
      },
      signOut: () => signOut(),
    };
  }, [status, settings, settingsError, me, message, store, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
