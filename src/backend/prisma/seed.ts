// Run with `npm run db:seed` (from the repo root) — idempotent, safe to run repeatedly.
// The same code runs on the AWS servers as `node dist/cli/seed.js`.
import { runSeed } from '../src/cli/seed.js';

try {
  process.loadEnvFile();
} catch {
  // No .env — use defaults.
}

await runSeed();
