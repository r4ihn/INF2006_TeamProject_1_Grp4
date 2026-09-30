// Import statements
import express, { Express, Request, Response } from "express";
import cors from "cors";
import type { Pool } from "pg";
import { loadAuthConfig } from "./auth/config.js";
import { authenticate } from "./auth/middleware.js";
import { createVerifier, type Verifier } from "./auth/verifier.js";
import { getPool } from "./db/pool.js";
import { createErrorHandler, HttpError } from "./errors.js";
import { requestLogger, silentLogger, type Logger } from "./logger.js";
import { catalogRouter } from "./routes/catalog.js";
import { movementsRouter } from "./routes/movements.js";
import { recommendationsRouter } from "./routes/recommendations.js";

export interface AppOptions {
  // Database access, resolved per request so the app can start (and /health can answer) without one.
  getDb?: () => Pool;
  // Token verification. Defaults to the AUTH_MODE configured in the environment, which must be set.
  verify?: Verifier;
  log?: Logger;
}

// Create app function and to return the health status
export function createApp(options: AppOptions = {}): Express {
  const db = options.getDb ?? getPool;
  const log = options.log ?? silentLogger;
  const verify = options.verify ?? createVerifier(loadAuthConfig());
  const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim());

  const app = express();
  app.disable("x-powered-by");
  app.use(requestLogger(log));
  app.use(express.json());
  app.use(cors({ origin: corsOrigins }));

  // The only unauthenticated route: a liveness probe for load balancers.
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  // Everything below requires a valid token.
  app.use(authenticate(verify, log));
  app.use(catalogRouter(db));
  app.use(movementsRouter(db, log));
  app.use(recommendationsRouter(db, log));
  app.use((req) => {
    throw new HttpError(
      404,
      "NOT_FOUND",
      `No route for ${req.method} ${req.path}`
    );
  });
  app.use(createErrorHandler(log));

  return app;
}
