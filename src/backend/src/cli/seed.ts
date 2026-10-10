// Adds the demo organisation (idempotent — safe to run on every start).
//   npm run db:seed            development (via prisma/seed.ts)
//   node dist/cli/seed.js      AWS app servers (compiled; no TypeScript tooling needed)
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import { createPrismaClient } from '../db/client.js';
import { seedDemoOrg } from '../db/seed.js';

export async function runSeed(): Promise<void> {
  const prisma = createPrismaClient(loadConfig().databaseUrl);
  try {
    const org = await seedDemoOrg(prisma);
    console.log(`Seeded organisation "${org.name}" (slug: ${org.slug}, id: ${org.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

// Run when called directly (not when imported)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile();
  } catch {
    // No .env — the environment (or the defaults) apply.
  }
  await runSeed();
}
