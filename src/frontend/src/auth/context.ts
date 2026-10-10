import { createContext, useContext } from 'react';
import type { AuthSettings, Me } from '../api';

export interface NewPasswordChallenge {
  session: string;
  username: string;
}

export interface AuthState {
  /** loading → checking the stored session; error → couldn't reach the server */
  status: 'loading' | 'signed-out' | 'signed-in' | 'error';
  settings: AuthSettings | null;
  settingsError: string | null;
  me: Me | null;
  /** Why the user was signed out, e.g. "Your session has expired" */
  message: string | null;
  signInDev: (role: 'staff' | 'manager') => Promise<void>;
  /** Returns a challenge if the user must choose a new password first */
  signInCognito: (email: string, password: string) => Promise<NewPasswordChallenge | null>;
  completeNewPassword: (challenge: NewPasswordChallenge, newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>');
  return auth;
}
