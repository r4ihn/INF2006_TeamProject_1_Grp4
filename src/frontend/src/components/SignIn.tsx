import { useState, type FormEvent } from 'react'
import { saveSession, type Session } from '../auth.ts'

interface Props {
  notice?: string
  onSignIn: (session: Session) => void
}

// Local development: paste a token from `npm run token -- staff|manager`.
// In the cloud this screen is replaced by Amazon Cognito's hosted sign-in.
export default function SignIn({ notice, onSignIn }: Props) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    const session = saveSession(token)
    if (!session) {
      setError('That is not a valid, unexpired token with a staff or manager role.')
      return
    }
    setError('')
    onSignIn(session)
  }

  return (
    <main className="signin">
      <h1>CafeStock</h1>
      <p className="muted">Stock control for your café. Sign in to continue.</p>
      {notice && <p className="banner warn" role="alert">{notice}</p>}
      <form onSubmit={submit} className="card stack">
        <label htmlFor="token">Access token</label>
        <textarea
          id="token"
          rows={5}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste your token here"
          spellCheck={false}
          autoComplete="off"
        />
        <p className="hint">
          Development sign-in. Generate one with <code>npm run token -- manager</code> (or{' '}
          <code>staff</code>) in <code>src/backend</code>.
        </p>
        {error && <p className="banner error" role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={!token.trim()}>
          Sign in
        </button>
      </form>
    </main>
  )
}
