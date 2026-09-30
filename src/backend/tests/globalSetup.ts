import pg from "pg";
import { migrate } from "../src/db/migrate.js";

// Bring the test database schema up to date once before any test file runs.
export default async function setup(): Promise<void> {
  const url =
    process.env.TEST_DATABASE_URL ??
    "postgres://cafestock:cafestock@localhost:5432/cafestock_test";
  const pool = new pg.Pool({ connectionString: url });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
