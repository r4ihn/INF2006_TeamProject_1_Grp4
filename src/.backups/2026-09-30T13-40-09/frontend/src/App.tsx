import { NavLink, Navigate, Route, Routes } from 'react-router';
import { useAuth } from './auth/context';
import { LoginPage } from './auth/LoginPage';
import { ForecastPage } from './forecast/ForecastPage';
import { ItemsPage } from './items/ItemsPage';
import { StockPage } from './stock/StockPage';
import { SuppliersPage } from './suppliers/SuppliersPage';
import { SystemStatus } from './SystemStatus';

const NAV = [
  { to: '/stock', label: 'Stock' },
  { to: '/items', label: 'Items' },
  { to: '/suppliers', label: 'Suppliers' },
  { to: '/forecast', label: 'Forecast', managerOnly: true },
];

export default function App() {
  const auth = useAuth();

  // Not signed in: only the login page, plus System status (handy when sign-in is broken)
  if (auth.status !== 'signed-in' || !auth.me) {
    return (
      <Routes>
        <Route
          path="/status"
          element={
            <div className="content">
              <StatusPage />
              <p>
                <NavLink to="/">← Back to sign in</NavLink>
              </p>
            </div>
          }
        />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  const { user, org } = auth.me;
  const isManager = user.role === 'MANAGER';

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">
          <span className="brand__mark" aria-hidden="true">
            ☕
          </span>
          CafeStock
        </span>
        <nav className="nav" aria-label="Main">
          {NAV.filter((item) => !item.managerOnly || isManager).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav__link${isActive ? ' nav__link--active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="account">
          <span className="account__who">
            <span className="account__name">{user.name ?? user.email}</span>
            <span className="account__meta">
              {org.name} ·{' '}
              <span className={`role role--${user.role.toLowerCase()}`}>
                {isManager ? 'Manager' : 'Staff'}
              </span>
            </span>
          </span>
          <button type="button" onClick={() => void auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/stock" replace />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/forecast" element={<ForecastPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      {/* A technical check (is the API up, can it reach the database?) — useful when something
          seems wrong, but not a daily task, so it lives here rather than in the main menu */}
      <footer className="footer">
        <NavLink to="/status" className="footer__link">
          System status
        </NavLink>
      </footer>
    </div>
  );
}

function StatusPage() {
  return (
    <>
      <h1>System status</h1>
      <p className="lede">Is the web app talking to the API, and the API to the database?</p>
      <SystemStatus />
    </>
  );
}

function NotFoundPage() {
  return (
    <>
      <h1>Page not found</h1>
      <p className="lede">
        That page doesn’t exist. <NavLink to="/items">Go to items</NavLink>
      </p>
    </>
  );
}
