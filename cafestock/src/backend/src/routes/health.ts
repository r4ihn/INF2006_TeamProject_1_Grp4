import { Router } from 'express';

export interface HealthDeps {
  /**
   * Resolves if the database answers. `tablesReady` says whether the migrations have
   * been applied (the database can be running but still empty). Rejects if unreachable.
   */
  pingDatabase: () => Promise<{ tablesReady: boolean }>;
}

// GET /health        — liveness: "is the Node process up?" Never touches the DB, so the
//                      load balancer (Task 11) doesn't kill every instance when RDS blips.
// GET /health/ready  — readiness: "can this instance actually serve data?" Pings the DB
//                      and checks the tables exist.
export function healthRouter({ pingDatabase }: HealthDeps): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'cafestock-api',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/ready', async (_req, res) => {
    const started = Date.now();
    let result: { tablesReady: boolean };
    try {
      result = await withTimeout(pingDatabase(), 3000);
    } catch (err) {
      console.error('Readiness check failed:', err instanceof Error ? err.message : err);
      res.status(503).json({ status: 'error', database: 'down' });
      return;
    }
    const latencyMs = Date.now() - started;
    if (!result.tablesReady) {
      res.status(503).json({ status: 'error', database: 'up', tables: 'missing', latencyMs });
      return;
    }
    res.status(200).json({ status: 'ok', database: 'up', tables: 'ok', latencyMs });
  });

  return router;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
