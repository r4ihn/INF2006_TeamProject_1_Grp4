// Structural checks on the migrated database: every migration applied, every table
// present, and the multi-tenant rules baked into the schema itself.
import { afterAll, describe, expect, it } from 'vitest';
import { BUSINESS_TABLES, createTestPrisma } from './test-db.js';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());

describe('migrations', () => {
  it('all applied cleanly (none failed or rolled back)', async () => {
    const rows = await prisma.$queryRaw<
      { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
    >`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.finished_at, row.migration_name).not.toBeNull();
      expect(row.rolled_back_at, row.migration_name).toBeNull();
    }
  });

  it('created every core table', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    const tables = rows.map((r) => r.table_name);

    expect(tables).toEqual(
      expect.arrayContaining(['organizations', '_prisma_migrations', ...BUSINESS_TABLES]),
    );
  });
});

describe('multi-tenancy is enforced by the schema', () => {
  it.each(BUSINESS_TABLES)('%s.org_id is NOT NULL', async (table) => {
    const rows = await prisma.$queryRaw<{ is_nullable: string }[]>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = 'org_id'`;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_nullable).toBe('NO');
  });

  it.each(BUSINESS_TABLES)('%s.org_id is a foreign key to organizations.id', async (table) => {
    const rows = await prisma.$queryRaw<{ ref_table: string }[]>`
      SELECT ccu.table_name AS ref_table
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        AND tc.table_name = ${table} AND kcu.column_name = 'org_id'
        AND ccu.table_name = 'organizations'`;

    expect(rows.length).toBeGreaterThan(0);
  });

  it('every table except organizations and Prisma bookkeeping is a business table', async () => {
    // Guards against someone adding a new table later and forgetting org_id.
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT t.table_name FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND t.table_name NOT IN ('organizations', '_prisma_migrations')
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND c.table_name = t.table_name
            AND c.column_name = 'org_id' AND c.is_nullable = 'NO')`;

    expect(rows.map((r) => r.table_name)).toEqual([]);
  });
});
