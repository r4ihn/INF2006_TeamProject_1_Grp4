// Import statements
import express, { Express, Request, Response } from "express";
import cors from "cors";
import type { Pool } from "pg";
import { getPool } from "./db/pool.js";
import { errorHandler } from "./errors.js";
import { catalogRouter } from "./routes/catalog.js";
import { movementsRouter } from "./routes/movements.js";

export interface AppOptions {
  // Database access, resolved per request so the app can start (and /health can answer) without one.
  getDb?: () => Pool;
}

// Create app function and to return the health status
export function createApp(options: AppOptions = {}): Express {
  const db = options.getDb ?? getPool;
  const app = express();
  app.use(express.json());
  app.use(cors());

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  app.use(catalogRouter(db));
  app.use(movementsRouter(db));
  app.use(errorHandler);

  return app;
}
