import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api';
import { useAuth, type NewPasswordChallenge } from './context';

function messageOf(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return 'Sign-in failed. Please try again.';
}

export function LoginPage() {
  const auth = useAuth();

  return (
    <div className="login">
      <div className="login__card card">
        <p className="brand login__brand">
          <span className="brand__mark" aria-hidden="true">
            ☕
          </span>
          CafeStock
        </p>
        <h1 className="login__title">Sign in</h1>

        {auth.message && (
          <p className="banner banner--error" role="alert">
            {auth.message}
          </p>
        )}

        {auth.status === 'error' && (
          <div className="banner banner--error" role="alert">
            {auth.settingsError}{' '}
            <button type="button" onClick={() => window.location.reload()}>
              Try again
            </button>
          </div>
        )}

        {auth.status === 'loading' && <p className="muted">Loading…</p>}

        {auth.status === 'signed-out' && auth.settings?.mode === 'dev' && <DevSignIn />}
        {auth.status === 'signed-out' && auth.settings?.mode === 'cognito' && <CognitoSignIn />}

        <p className="login__footer muted">
          <Link to="/status">System status</Link>
        </p>
      </div>
    </div>
  );
}

function DevSignIn() {
  const auth = useAuth();
  const [busy, setBusy] = useState<'staff' | 'manager' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (role: 'staff' | 'manager') => {
    setBusy(role);
    setError(null);
    try {
      await auth.signInDev(role);
    } catch (err) {
      setError(messageOf(err));
      setBusy(null);
    }
  };

  return (
    <>
      <p className="banner banner--info">
        <strong>Development sign-in.</strong> No AWS needed — pick a role. Real accounts use Amazon
        Cognito (see <code>docs/cognito-setup.md</code>).
      </p>
      {error && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
      <div className="login__roles">
        <button
          type="button"
          className="role-card"
          onClick={() => go('staff')}
          disabled={busy !== null}
        >
          <span className="role-card__title">
            {busy === 'staff' ? 'Signing in…' : 'Continue as staff'}
          </span>
          <span className="role-card__who">Sam · staff@demo.cafe</span>
          <span className="role-card__can">Suppliers, items and stock</span>
        </button>
        <button
          type="button"
          className="role-card"
          onClick={() => go('manager')}
          disabled={busy !== null}
        >
          <span className="role-card__title">
            {busy === 'manager' ? 'Signing in…' : 'Continue as manager'}
          </span>
          <span className="role-card__who">Mia · manager@demo.cafe</span>
          <span className="role-card__can">Everything, plus the forecast</span>
        </button>
      </div>
    </>
  );
}

function CognitoSignIn() {
  const auth = useAuth();
  const uid = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<NewPasswordChallenge | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitSignIn(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const c = await auth.signInCognito(email, password);
      if (c) {
        setChallenge(c);
        setPassword('');
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitNewPassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 10 || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError('Use at least 10 characters, including lower-case letters and a number.');
      return;
    }
    if (newPassword !== confirm) {
      setError('The two passwords don’t match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await auth.completeNewPassword(challenge!, newPassword);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  const errorBanner = error && (
    <p className="banner banner--error" role="alert">
      {error}
    </p>
  );

  if (challenge) {
    return (
      <form
        className="login__form"
        onSubmit={submitNewPassword}
        noValidate
        aria-label="Choose a new password"
      >
        <p className="muted">Welcome! Choose your own password to replace the temporary one.</p>
        {errorBanner}
        <div className="field">
          <label htmlFor={`${uid}-new`}>New password</label>
          <input
            id={`${uid}-new`}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoFocus
          />
          <p className="field__hint">
            At least 10 characters, with lower-case letters and a number.
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-confirm`}>Confirm new password</label>
          <input
            id={`${uid}-confirm`}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button type="submit" className="button--primary login__submit" disabled={busy}>
          {busy ? 'Saving…' : 'Set password and sign in'}
        </button>
      </form>
    );
  }

  return (
    <form className="login__form" onSubmit={submitSignIn} noValidate aria-label="Sign in">
      {errorBanner}
      <div className="field">
        <label htmlFor={`${uid}-email`}>Email</label>
        <input
          id={`${uid}-email`}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-password`}>Password</label>
        <input
          id={`${uid}-password`}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <button type="submit" className="button--primary login__submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="field__hint">
        Forgot your password? Ask the café owner to inform IT admin to change it.
      </p>
    </form>
  );
}
