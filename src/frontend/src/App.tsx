import { useEffect, useState } from 'react'
import { api, setUnauthorizedHandler, type StockItem } from './api.ts'
import { clearSession, loadSession, type Session } from './auth.ts'
import MovementForm from './components/MovementForm.tsx'
import MovementList from './components/MovementList.tsx'
import SignIn from './components/SignIn.tsx'
import StockTable from './components/StockTable.tsx'
import './App.css'

function ApiStatus() {
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking')

  useEffect(() => {
    api
      .health()
      .then(() => setStatus('online'))
      .catch(() => setStatus('offline'))
  }, [])

  const label = { checking: 'Checking API…', online: 'API online', offline: 'API unreachable' }[status]
  return <span className={`status ${status}`}>{label}</span>
}

function Dashboard({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [stock, setStock] = useState<StockItem[] | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [productId, setProductId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .stock()
      .then((items) => {
        if (cancelled) return
        setStock(items)
        setError('')
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [version])

  const low = stock?.filter((i) => i.isLow).length ?? 0
  const expired = stock?.filter((i) => i.expiredQuantity > 0).length ?? 0

  return (
    <>
      <header className="topbar">
        <h1>CafeStock</h1>
        <div className="who">
          <ApiStatus />
          <span>
            {session.username} <span className="role">{session.role}</span>
          </span>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="layout">
        {error && (
          <p className="banner error wide" role="alert">
            {error}
          </p>
        )}
        {stock && (
          <>
            <ul className="summary wide" aria-label="Stock summary">
              <li>
                <strong>{stock.length}</strong> items tracked
              </li>
              <li className={low > 0 ? 'alert' : ''}>
                <strong>{low}</strong> below reorder level
              </li>
              <li className={expired > 0 ? 'alert' : ''}>
                <strong>{expired}</strong> holding expired stock
              </li>
            </ul>
            <div className="main-col">
              <StockTable items={stock} onRecord={setProductId} />
            </div>
            <aside className="side-col">
              <MovementForm
                items={stock}
                role={session.role}
                productId={productId}
                onProductChange={setProductId}
                onRecorded={() => setVersion((v) => v + 1)}
              />
            </aside>
            <div className="wide">
              <MovementList items={stock} refreshKey={version} />
            </div>
          </>
        )}
        {!stock && !error && <p className="muted wide">Loading stock…</p>}
      </main>
    </>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession()
      setSession(null)
      setNotice('Your session was rejected or has expired. Please sign in again.')
    })
  }, [])

  if (!session) {
    return (
      <SignIn
        notice={notice}
        onSignIn={(s) => {
          setNotice('')
          setSession(s)
        }}
      />
    )
  }
  return (
    <Dashboard
      session={session}
      onSignOut={() => {
        clearSession()
        setSession(null)
        setNotice('')
      }}
    />
  )
}
