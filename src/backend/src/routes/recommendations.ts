import { Router } from "express";
import type { Pool } from "pg";
import { suggestOrder } from "../analytics/reorder.js";
import { requireRole } from "../auth/middleware.js";
import type { Logger } from "../logger.js";

// Manager-only view of the reorder recommendations. The forecast and safety stock are the analytics
// run's published numbers; the suggested order is recomputed against stock as it is right now.
export function recommendationsRouter(db: () => Pool, log: Logger): Router {
  const router = Router();

  router.get(
    "/recommendations",
    requireRole("manager", log),
    async (_req, res) => {
      const runs = await db().query(
        `SELECT run_id AS "runId", method, as_of AS "asOf", service_z AS "serviceZ",
              cover_weeks AS "coverWeeks", source, evaluation
       FROM forecast_runs ORDER BY run_id DESC LIMIT 1`
      );
      const run = runs.rows[0];
      if (!run) {
        res.json({ run: null, items: [] });
        return;
      }

      const { rows } = await db().query(
        `SELECT p.product_id AS "productId", p.sku, p.name, p.unit, p.pack_size AS "packSize",
              p.pack_description AS "packDescription", p.shelf_life_days AS "shelfLifeDays",
              s.on_hand AS "onHand", s.expired_quantity AS "expiredQuantity",
              r.forecast_next_week AS "forecastNextWeek", r.safety_stock AS "safetyStock",
              r.stock_at_run AS "stockAtRun", r.suggested_order_packs AS "publishedPacks",
              r.suggested_order_units AS "publishedUnits",
              r.capped_by_shelf_life AS "publishedCapped",
              r.weeks_of_cover_after_order AS "publishedWeeksOfCover", r.method_mase AS "methodMase"
       FROM reorder_recommendations r
       JOIN products p USING (product_id)
       JOIN current_stock s USING (product_id)
       WHERE r.run_id = $1
       ORDER BY p.name`,
        [run.runId]
      );

      const items = rows.map((r) => {
        const suggested = suggestOrder({
          forecast: r.forecastNextWeek,
          safetyStock: r.safetyStock,
          onHand: r.onHand,
          packSize: r.packSize ?? 1,
          shelfLifeDays: r.shelfLifeDays,
          coverWeeks: run.coverWeeks,
        });
        return {
          productId: r.productId,
          sku: r.sku,
          name: r.name,
          unit: r.unit,
          packSize: r.packSize,
          packDescription: r.packDescription,
          onHand: r.onHand,
          expiredQuantity: r.expiredQuantity,
          forecastNextWeek: r.forecastNextWeek,
          safetyStock: r.safetyStock,
          methodMase: r.methodMase,
          stockAtRun: r.stockAtRun,
          published: {
            packs: r.publishedPacks,
            units: r.publishedUnits,
            cappedByShelfLife: r.publishedCapped,
            weeksOfCover: r.publishedWeeksOfCover,
          },
          suggested,
        };
      });

      res.json({ run, items });
    }
  );

  return router;
}
