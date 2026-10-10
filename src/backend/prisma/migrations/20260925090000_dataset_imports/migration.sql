-- Task 7: dataset import (provenance, imported ledger rows, 4-decimal unit costs).

-- AlterTable
ALTER TABLE "demand_history" ADD COLUMN     "import_id" UUID;

-- AlterTable
ALTER TABLE "inventory_movements" ADD COLUMN     "import_id" UUID;

-- AlterTable
ALTER TABLE "items" ALTER COLUMN "unit_cost" SET DATA TYPE DECIMAL(12,4);

-- CreateTable
CREATE TABLE "dataset_imports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "item_count" INTEGER NOT NULL,
    "day_count" INTEGER NOT NULL,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "date_shift_days" INTEGER NOT NULL DEFAULT 0,
    "items_created" INTEGER NOT NULL,
    "demand_inserted" INTEGER NOT NULL,
    "demand_updated" INTEGER NOT NULL,
    "demand_unchanged" INTEGER NOT NULL,
    "demand_skipped" INTEGER NOT NULL,
    "movements_inserted" INTEGER NOT NULL,
    "ledger_items_skipped" INTEGER NOT NULL,
    "replaced" BOOLEAN NOT NULL DEFAULT false,
    "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataset_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dataset_imports_org_id_imported_at_idx" ON "dataset_imports"("org_id", "imported_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "dataset_imports_id_org_id_key" ON "dataset_imports"("id", "org_id");

-- CreateIndex
CREATE INDEX "demand_history_org_id_import_id_idx" ON "demand_history"("org_id", "import_id");

-- CreateIndex
CREATE INDEX "inventory_movements_org_id_import_id_idx" ON "inventory_movements"("org_id", "import_id");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_import_id_org_id_fkey" FOREIGN KEY ("import_id", "org_id") REFERENCES "dataset_imports"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_history" ADD CONSTRAINT "demand_history_import_id_org_id_fkey" FOREIGN KEY ("import_id", "org_id") REFERENCES "dataset_imports"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_imports" ADD CONSTRAINT "dataset_imports_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written CHECK constraints (Prisma's schema language can't express these).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "dataset_imports" ADD CONSTRAINT "dataset_imports_source_not_blank_check"
  CHECK (btrim("source") <> '');
ALTER TABLE "dataset_imports" ADD CONSTRAINT "dataset_imports_files_check"
  CHECK (jsonb_typeof("files") = 'array');
ALTER TABLE "dataset_imports" ADD CONSTRAINT "dataset_imports_counts_check"
  CHECK ("item_count" >= 0 AND "day_count" >= 0 AND "items_created" >= 0
     AND "demand_inserted" >= 0 AND "demand_updated" >= 0 AND "demand_unchanged" >= 0
     AND "demand_skipped" >= 0 AND "movements_inserted" >= 0 AND "ledger_items_skipped" >= 0);
ALTER TABLE "dataset_imports" ADD CONSTRAINT "dataset_imports_date_range_check"
  CHECK ("date_to" >= "date_from");

-- Only imported demand rows point at an import run.
ALTER TABLE "demand_history" ADD CONSTRAINT "demand_history_import_source_check"
  CHECK ("import_id" IS NULL OR "source" = 'IMPORT');

-- A ledger row is either recorded by someone in the app or imported, never both.
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_import_or_user_check"
  CHECK ("import_id" IS NULL OR "created_by_id" IS NULL);
