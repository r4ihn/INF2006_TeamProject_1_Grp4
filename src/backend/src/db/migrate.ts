import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { loadEnv } from "../env.js";
import { closePool, getPool } from "./pool.js";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations");
const LOCK_KEY = 2006001;

// Apply every migrations/*.sql file that has not been applied yet, in filename order.
export async function migrate(db: pg.Pool): Promise<string[]> {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename   text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`
    );
    const done = new Set(
      (await client.query("SELECT filename FROM schema_migrations")).rows.map(
        (r) => r.filename as string
      )
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, {
          cause: err,
        });
      }
      applied.push(file);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    client.release();
  }
  return applied;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnv();
  migrate(getPool())
    .then((applied) => {
      console.log(
        applied.length
          ? `Applied: ${applied.join(", ")}`
          : "Database is up to date"
      );
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(closePool);
}
