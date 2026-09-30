import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "../errors.js";
import { idParam, listStockQuery } from "../validation.js";

const PRODUCT_COLUMNS = `
  product_id AS "productId", sku, name, unit, unit_cost AS "unitCost",
  shelf_life_days AS "shelfLifeDays", storage_location AS "storageLocation",
  supplier_id AS "supplierId", lead_time_days AS "leadTimeDays", pack_size AS "packSize",
  pack_description AS "packDescription", reorder_threshold AS "reorderThreshold",
  reorder_quantity AS "reorderQuantity"`;

// Read-only catalogue endpoints: suppliers, products and the derived current stock.
export function catalogRouter(db: () => Pool): Router {
  const router = Router();

  router.get("/suppliers", async (_req, res) => {
    const { rows } = await db().query(
      `SELECT supplier_id AS "supplierId", name, contact_email AS "contactEmail"
       FROM suppliers ORDER BY name`
    );
    res.json(rows);
  });

  router.get("/products", async (_req, res) => {
    const { rows } = await db().query(
      `SELECT ${PRODUCT_COLUMNS} FROM products ORDER BY name`
    );
    res.json(rows);
  });

  router.get("/products/:id", async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { rows } = await db().query(
      `SELECT ${PRODUCT_COLUMNS} FROM products WHERE product_id = $1`,
      [id]
    );
    if (!rows[0])
      throw new HttpError(404, "PRODUCT_NOT_FOUND", `No product ${id}`);
    res.json(rows[0]);
  });

  // Current stock is derived from the ledger by the current_stock view; it is never stored.
  router.get("/stock", async (req, res) => {
    const { lowOnly } = listStockQuery.parse(req.query);
    const { rows } = await db().query(
      `SELECT product_id AS "productId", sku, name, unit, storage_location AS "storageLocation",
              on_hand AS "onHand", reorder_threshold AS "reorderThreshold",
              reorder_quantity AS "reorderQuantity", is_low AS "isLow",
              earliest_expiry AS "earliestExpiry", expired_quantity AS "expiredQuantity"
       FROM current_stock
       ${lowOnly ? "WHERE is_low" : ""}
       ORDER BY name`
    );
    res.json(rows);
  });

  router.get("/products/:id/batches", async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { rows } = await db().query(
      `SELECT batch_id AS "batchId", expiry_date AS "expiryDate",
              storage_location AS "storageLocation", remaining
       FROM batch_stock WHERE product_id = $1 AND remaining > 0
       ORDER BY expiry_date NULLS LAST, batch_id`,
      [id]
    );
    res.json(rows);
  });

  return router;
}
