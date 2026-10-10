// Runs once before the db test project: wipes the test database and applies every
// migration from scratch — which is itself the "migration applies cleanly" check.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { testDatabaseUrl } from './test-db.js';

export default async function setup() {
  const url = testDatabaseUrl();
  const safeUrl = url.replace(/\/\/[^@]*@/, '//***@');

  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `\n\nCannot reach the test database at ${safeUrl}\n` +
        `  → Is Docker Desktop running? Start the database with:  npm run db:up\n` +
        `  (${err instanceof Error ? err.message : String(err)})\n`,
      { cause: err },
    );
  }
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }

  // Run the Prisma CLI with the current Node binary (works the same on Windows/macOS/Linux).
  const require = createRequire(import.meta.url);
  const prismaCli = join(dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
  try {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      // Run from backend/ so Prisma finds prisma.config.ts, whatever folder the tests started in
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
  } catch (err) {
    const out = err as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `prisma migrate deploy failed on the test database:\n${out.stdout ?? ''}${out.stderr ?? ''}`,
      { cause: err },
    );
  }
}
