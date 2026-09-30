import { defineConfig } from "vitest/config";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://cafestock:cafestock@localhost:5432/cafestock_test";

export default defineConfig({
  test: {
    env: { DATABASE_URL: TEST_DATABASE_URL },
    globalSetup: ["tests/globalSetup.ts"],
    // The tests share one Postgres database, so files must not run at the same time.
    fileParallelism: false,
  },
});
