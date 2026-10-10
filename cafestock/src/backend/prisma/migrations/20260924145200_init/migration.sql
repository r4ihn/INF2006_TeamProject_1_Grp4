-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('STAFF', 'MANAGER');

-- CreateEnum
CREATE TYPE "movement_type" AS ENUM ('RECEIVE', 'USAGE', 'WASTE', 'ADJUSTMENT', 'COUNT');

-- CreateEnum
CREATE TYPE "demand_source" AS ENUM ('IMPORT', 'MOVEMENTS');

-- CreateEnum
CREATE TYPE "model_kind" AS ENUM ('ML', 'BASELINE');

-- CreateEnum
CREATE TYPE "run_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "recommendation_status" AS ENUM ('OK', 'REORDER', 'URGENT');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Singapore',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "cognito_sub" TEXT,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'STAFF',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "lead_time_days" INTEGER NOT NULL DEFAULT 2,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "supplier_id" UUID,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "on_hand" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "reorder_point" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "spoilage_cap" DECIMAL(12,3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "type" "movement_type" NOT NULL,
    "quantity_change" DECIMAL(12,3) NOT NULL,
    "quantity_after" DECIMAL(12,3) NOT NULL,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demand_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "source" "demand_source" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "model_tag" TEXT NOT NULL,
    "model_kind" "model_kind" NOT NULL,
    "is_fallback" BOOLEAN NOT NULL DEFAULT false,
    "status" "run_status" NOT NULL DEFAULT 'RUNNING',
    "horizon_days" INTEGER NOT NULL DEFAULT 7,
    "mape_model" DECIMAL(6,4),
    "mape_baseline" DECIMAL(6,4),
    "service_level_z" DECIMAL(4,2) NOT NULL DEFAULT 1.65,
    "model_uri" TEXT,
    "items_processed" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "forecast_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecasts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "forecast_date" DATE NOT NULL,
    "predicted_qty" DECIMAL(12,3) NOT NULL,
    "lower_qty" DECIMAL(12,3),
    "upper_qty" DECIMAL(12,3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reorder_recommendations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "on_hand" DECIMAL(12,3) NOT NULL,
    "lead_time_days" INTEGER NOT NULL,
    "avg_daily_demand" DECIMAL(12,3) NOT NULL,
    "demand_std_dev" DECIMAL(12,3) NOT NULL,
    "lead_time_demand" DECIMAL(12,3) NOT NULL,
    "safety_stock" DECIMAL(12,3) NOT NULL,
    "reorder_point" DECIMAL(12,3) NOT NULL,
    "shortfall" DECIMAL(12,3) NOT NULL,
    "recommended_qty" DECIMAL(12,3) NOT NULL,
    "spoilage_cap_applied" BOOLEAN NOT NULL DEFAULT false,
    "cover_days" DECIMAL(8,2),
    "item_mape" DECIMAL(6,4),
    "status" "recommendation_status" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reorder_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_cognito_sub_key" ON "users"("cognito_sub");

-- CreateIndex
CREATE UNIQUE INDEX "users_org_id_email_key" ON "users"("org_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_org_id_key" ON "users"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_org_id_name_key" ON "suppliers"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_id_org_id_key" ON "suppliers"("id", "org_id");

-- CreateIndex
CREATE INDEX "items_org_id_supplier_id_idx" ON "items"("org_id", "supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "items_org_id_name_key" ON "items"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "items_org_id_sku_key" ON "items"("org_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "items_id_org_id_key" ON "items"("id", "org_id");

-- CreateIndex
CREATE INDEX "inventory_movements_org_id_item_id_occurred_at_idx" ON "inventory_movements"("org_id", "item_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "demand_history_org_id_item_id_date_key" ON "demand_history"("org_id", "item_id", "date");

-- CreateIndex
CREATE INDEX "forecast_runs_org_id_started_at_idx" ON "forecast_runs"("org_id", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "forecast_runs_id_org_id_key" ON "forecast_runs"("id", "org_id");

-- CreateIndex
CREATE INDEX "forecasts_org_id_item_id_forecast_date_idx" ON "forecasts"("org_id", "item_id", "forecast_date");

-- CreateIndex
CREATE UNIQUE INDEX "forecasts_run_id_item_id_forecast_date_key" ON "forecasts"("run_id", "item_id", "forecast_date");

-- CreateIndex
CREATE INDEX "reorder_recommendations_org_id_item_id_idx" ON "reorder_recommendations"("org_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "reorder_recommendations_run_id_item_id_key" ON "reorder_recommendations"("run_id", "item_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_supplier_id_org_id_fkey" FOREIGN KEY ("supplier_id", "org_id") REFERENCES "suppliers"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_id_org_id_fkey" FOREIGN KEY ("item_id", "org_id") REFERENCES "items"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_id_org_id_fkey" FOREIGN KEY ("created_by_id", "org_id") REFERENCES "users"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_history" ADD CONSTRAINT "demand_history_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_history" ADD CONSTRAINT "demand_history_item_id_org_id_fkey" FOREIGN KEY ("item_id", "org_id") REFERENCES "items"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_run_id_org_id_fkey" FOREIGN KEY ("run_id", "org_id") REFERENCES "forecast_runs"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_item_id_org_id_fkey" FOREIGN KEY ("item_id", "org_id") REFERENCES "items"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reorder_recommendations" ADD CONSTRAINT "reorder_recommendations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reorder_recommendations" ADD CONSTRAINT "reorder_recommendations_run_id_org_id_fkey" FOREIGN KEY ("run_id", "org_id") REFERENCES "forecast_runs"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reorder_recommendations" ADD CONSTRAINT "reorder_recommendations_item_id_org_id_fkey" FOREIGN KEY ("item_id", "org_id") REFERENCES "items"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written CHECK constraints (Prisma's schema language can't express these).
-- They protect data written by any client, including the Python forecast Lambda.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_format_check"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_name_not_blank_check" CHECK (btrim("name") <> '');
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_lead_time_days_check"
  CHECK ("lead_time_days" BETWEEN 0 AND 365);

ALTER TABLE "items" ADD CONSTRAINT "items_name_not_blank_check" CHECK (btrim("name") <> '');
ALTER TABLE "items" ADD CONSTRAINT "items_unit_cost_check" CHECK ("unit_cost" >= 0);
ALTER TABLE "items" ADD CONSTRAINT "items_on_hand_check" CHECK ("on_hand" >= 0);
ALTER TABLE "items" ADD CONSTRAINT "items_reorder_point_check" CHECK ("reorder_point" >= 0);
ALTER TABLE "items" ADD CONSTRAINT "items_spoilage_cap_check"
  CHECK ("spoilage_cap" IS NULL OR "spoilage_cap" >= 0);

ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_quantity_after_check"
  CHECK ("quantity_after" >= 0);

ALTER TABLE "demand_history" ADD CONSTRAINT "demand_history_quantity_check" CHECK ("quantity" >= 0);

ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_horizon_days_check"
  CHECK ("horizon_days" BETWEEN 1 AND 90);
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_mape_check"
  CHECK (("mape_model" IS NULL OR "mape_model" >= 0) AND ("mape_baseline" IS NULL OR "mape_baseline" >= 0));
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_items_processed_check"
  CHECK ("items_processed" >= 0);
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_finished_after_started_check"
  CHECK ("finished_at" IS NULL OR "finished_at" >= "started_at");

ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_predicted_qty_check" CHECK ("predicted_qty" >= 0);
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_band_check"
  CHECK (("lower_qty" IS NULL OR ("lower_qty" >= 0 AND "lower_qty" <= "predicted_qty"))
     AND ("upper_qty" IS NULL OR "upper_qty" >= "predicted_qty"));

ALTER TABLE "reorder_recommendations" ADD CONSTRAINT "reorder_recommendations_non_negative_check"
  CHECK ("on_hand" >= 0 AND "lead_time_days" >= 0 AND "avg_daily_demand" >= 0
     AND "demand_std_dev" >= 0 AND "lead_time_demand" >= 0 AND "safety_stock" >= 0
     AND "reorder_point" >= 0 AND "shortfall" >= 0 AND "recommended_qty" >= 0
     AND ("cover_days" IS NULL OR "cover_days" >= 0)
     AND ("item_mape" IS NULL OR "item_mape" >= 0));
