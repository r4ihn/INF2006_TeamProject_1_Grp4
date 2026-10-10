import { defineConfig } from 'vitest/config';

// Two groups of tests:
//   unit — no database needed (fast)
//   db   — run against a real PostgreSQL test database, rebuilt from the migrations
//          on every run by tests/db/global-setup.ts. Needs `npm run db:up` first.
export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          globalSetup: ['tests/db/global-setup.ts'],
          // DB test files share one database, so run them one at a time.
          fileParallelism: false,
          testTimeout: 15_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
