import { useEffect, useState } from 'react';
import { fetchHealth, fetchReadiness } from './api';

type Check =
  | { kind: 'loading'; detail?: string }
  | { kind: 'ok'; detail: string }
  | { kind: 'error'; detail: string }
  | { kind: 'unknown'; detail: string };

interface Checks {
  api: Check;
  db: Check;
}

const LOADING: Checks = { api: { kind: 'loading' }, db: { kind: 'loading' } };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface Props {
  /**
   * When the page first loads, `npm run dev` may still be starting the API (the web app is
   * ready in under a second, the API takes a few). Retry quietly this many times before
   * showing "API unreachable".
   */
  startupRetries?: number;
  retryDelayMs?: number;
}

export function SystemStatus({ startupRetries = 10, retryDelayMs = 1000 }: Props) {
  const [checks, setChecks] = useState<Checks>(LOADING);
  // Bumping this number re-runs the effect below (Re-check button, or a startup retry).
  const [attempt, setAttempt] = useState(0);
  const [retriesLeft, setRetriesLeft] = useState(startupRetries);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    Promise.allSettled([fetchHealth(signal), fetchReadiness(signal)]).then(([api, db]) => {
      if (signal.aborted) return; // component unmounted / re-checked

      if (api.status === 'rejected' && retriesLeft > 0) {
        setChecks({
          api: { kind: 'loading', detail: 'Waiting for the API to start…' },
          db: { kind: 'loading' },
        });
        retryTimer = setTimeout(() => {
          setRetriesLeft((n) => n - 1);
          setAttempt((n) => n + 1);
        }, retryDelayMs);
        return;
      }

      const apiCheck: Check =
        api.status === 'fulfilled'
          ? {
              kind: 'ok',
              detail: `${api.value.service} · up ${api.value.uptimeSeconds}s · checked ${new Date(
                api.value.timestamp,
              ).toLocaleTimeString()}`,
            }
          : {
              kind: 'error',
              detail: `${message(api.reason)}. Is the backend running on port 3000?`,
            };

      let dbCheck: Check;
      if (api.status === 'rejected') {
        dbCheck = { kind: 'unknown', detail: 'Can’t check the database until the API is up.' };
      } else if (db.status === 'fulfilled') {
        dbCheck = { kind: 'ok', detail: `PostgreSQL responded in ${db.value.latencyMs} ms` };
      } else {
        const tablesMissing = (db.reason as { code?: string })?.code === 'TABLES_MISSING';
        dbCheck = {
          kind: 'error',
          detail: tablesMissing
            ? `${message(db.reason)}. Run: npm run db:setup`
            : `${message(db.reason)}. Is Docker Desktop running? Try: npm run db:setup`,
        };
      }

      setChecks({ api: apiCheck, db: dbCheck });
      setRetriesLeft(0); // startup is over; later failures show immediately
    });

    return () => {
      controller.abort();
      clearTimeout(retryTimer);
    };
    // retriesLeft is read, not reacted to: only `attempt` should trigger a new check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, retryDelayMs]);

  function recheck() {
    setChecks(LOADING);
    setAttempt((n) => n + 1);
  }

  const busy = checks.api.kind === 'loading';

  return (
    <section className="status-card" aria-live="polite">
      <StatusRow
        check={checks.api}
        labels={{ loading: 'Checking API…', ok: 'API healthy', error: 'API unreachable' }}
      />
      <StatusRow
        check={checks.db}
        labels={{
          loading: 'Checking database…',
          ok: 'Database connected',
          error: 'Database unreachable',
          unknown: 'Database status unknown',
        }}
      />
      <div className="status-card__actions">
        <button type="button" onClick={recheck} disabled={busy}>
          Re-check
        </button>
      </div>
    </section>
  );
}

function StatusRow({
  check,
  labels,
}: {
  check: Check;
  labels: { loading: string; ok: string; error: string; unknown?: string };
}) {
  const title = check.kind === 'unknown' ? (labels.unknown ?? labels.error) : labels[check.kind];
  return (
    <div className={`status status--${check.kind}`}>
      <span className="status__dot" aria-hidden="true" />
      <div className="status__body">
        <p className="status__title">{title}</p>
        {check.detail && <p className="status__meta">{check.detail}</p>}
      </div>
    </div>
  );
}
