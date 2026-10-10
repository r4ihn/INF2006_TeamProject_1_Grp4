import { createPrismaClient, type PrismaClient } from '../../src/db/client.js';

export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://cafestock:cafestock@localhost:5433/cafestock_test';

export function testDatabaseUrl(): string {
  try {
    process.loadEnvFile();
  } catch {
    // no .env
  }
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const dbName = new URL(url).pathname.replace(/^\//, '');
  // Safety net: the test run wipes this database, so refuse anything not clearly a test DB.
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL must point at a database whose name ends in "_test" (got "${dbName}").`,
    );
  }
  return url;
}

export function createTestPrisma(): PrismaClient {
  return createPrismaClient(testDatabaseUrl());
}

/** Business tables, in an order safe for TRUNCATE … CASCADE. */
export const BUSINESS_TABLES = [
  'users',
  'suppliers',
  'items',
  'inventory_movements',
  'dataset_imports',
  'demand_history',
  'forecast_runs',
  'forecasts',
  'reorder_recommendations',
] as const;

/** Empties every table (keeps the schema and migration history). */
export async function resetData(prisma: PrismaClient): Promise<void> {
  const tables = ['organizations', ...BUSINESS_TABLES].map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

/** Creates an organisation with a unique slug. */
export async function makeOrg(prisma: PrismaClient, name = 'Test Café') {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const slug = `${base}-${crypto.randomUUID().slice(0, 8)}`;
  return prisma.organization.create({ data: { name, slug } });
}

export { pgErrorCode } from '../../src/db/errors.js';
