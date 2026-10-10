-- Task 9: what the manager's forecast page shows (headline MASE, forecast date, how an order is worked out).

-- AlterTable
ALTER TABLE "forecast_runs" ADD COLUMN     "baseline_tag" TEXT,
ADD COLUMN     "eval_weeks" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "forecast_from" DATE NOT NULL DEFAULT CURRENT_DATE,
ADD COLUMN     "mase_baseline" DECIMAL(6,4),
ADD COLUMN     "mase_model" DECIMAL(6,4),
ADD COLUMN     "review_days" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "reorder_recommendations" ADD COLUMN     "history_days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "item_mase" DECIMAL(6,4),
ADD COLUMN     "notes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "order_up_to" DECIMAL(12,3) NOT NULL DEFAULT 0,
ADD COLUMN     "review_demand" DECIMAL(12,3) NOT NULL DEFAULT 0;


-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written CHECK constraints (Prisma's schema language can't express these).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_mase_check"
  CHECK (("mase_model" IS NULL OR "mase_model" >= 0) AND ("mase_baseline" IS NULL OR "mase_baseline" >= 0));
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_eval_review_check"
  CHECK ("eval_weeks" BETWEEN 1 AND 104 AND "review_days" BETWEEN 0 AND 90);

ALTER TABLE "reorder_recommendations" ADD CONSTRAINT "reorder_recommendations_order_check"
  CHECK ("review_demand" >= 0 AND "order_up_to" >= 0 AND "history_days" >= 0
     AND ("item_mase" IS NULL OR "item_mase" >= 0));
