import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { getUser } from "../auth/middleware.js";
import { withTransaction } from "../db/pool.js";
import { HttpError } from "../errors.js";
import type { Logger } from "../logger.js";
import {
  listMovementsQuery,
  movementBody,
  type MovementBody,
} from "../validation.js";

const MOVEMENT_COLUMNS = `
  movement_id AS "movementId", occurred_at AS "occurredAt", product_id AS "productId",
  movement_type AS "movementType", quantity, batch_id AS "batchId", expiry_date AS "expiryDate",
  storage_location AS "storageLocation", reason, source, recorded_by AS "recordedBy"`;

interface Product {
  unit: string;
  shelf_life_days: number | null;
  storage_location: string | null;
}

interface PendingRow {
  batchId: string;
  quantity: number;
  expiryDate: string | null;
  storageLocation: string | null;
}

// Expiry and location belong to the batch; they are copied from the RECEIVE that created it.
async function findBatch(c: PoolClient, productId: number, batchId: string) {
  const { rows } = await c.query(
    `SELECT expiry_date, storage_location FROM stock_movements
     WHERE product_id = $1 AND batch_id = $2 AND movement_type = 'RECEIVE'`,
    [productId, batchId]
  );
  if (!rows[0]) {
    throw new HttpError(
      422,
      "UNKNOWN_BATCH",
      `Batch ${batchId} does not exist for product ${productId}`
    );
  }
  return {
    expiryDate: rows[0].expiry_date as string | null,
    storageLocation: rows[0].storage_location as string | null,
  };
}

// Decide which ledger rows a request turns into.
async function planRows(
  c: PoolClient,
  m: MovementBody,
  p: Product
): Promise<PendingRow[]> {
  if (m.movementType === "RECEIVE") {
    const today = new Date().toISOString().slice(0, 10);
    let expiryDate = m.expiryDate ?? null;
    if (!expiryDate && p.shelf_life_days) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + p.shelf_life_days);
      expiryDate = d.toISOString().slice(0, 10);
    }
    if (expiryDate && expiryDate < today) {
      throw new HttpError(
        422,
        "ALREADY_EXPIRED",
        "Cannot receive stock that has already expired"
      );
    }
    const batchId =
      m.batchId ??
      (
        await c.query(
          `SELECT 'B' || lpad(nextval('batch_id_seq')::text, 6, '0') AS id`
        )
      ).rows[0].id;
    return [
      {
        batchId,
        quantity: m.quantity,
        expiryDate,
        storageLocation: p.storage_location,
      },
    ];
  }

  if (m.batchId) {
    const batch = await findBatch(c, m.productId, m.batchId);
    const sign = m.movementType === "ADJUST" ? 1 : -1;
    return [{ batchId: m.batchId, quantity: sign * m.quantity, ...batch }];
  }

  // SELL without a batch: first-expiry-first-out, which may span several batches.
  const { rows } = await c.query(
    `SELECT batch_id, expiry_date, storage_location, remaining FROM batch_stock
     WHERE product_id = $1 AND remaining > 0
     ORDER BY expiry_date NULLS LAST, batch_id`,
    [m.productId]
  );
  const plan: PendingRow[] = [];
  let left = m.quantity;
  for (const b of rows) {
    if (left <= 0) break;
    const take = Math.min(left, b.remaining as number);
    plan.push({
      batchId: b.batch_id,
      quantity: -take,
      expiryDate: b.expiry_date,
      storageLocation: b.storage_location,
    });
    left = Math.round((left - take) * 1000) / 1000;
  }
  if (left > 0) {
    const onHand = rows.reduce((s, b) => s + (b.remaining as number), 0);
    throw new HttpError(
      409,
      "INSUFFICIENT_STOCK",
      `Only ${onHand} in stock, requested ${m.quantity}`,
      {
        onHand,
        requested: m.quantity,
      }
    );
  }
  return plan;
}

// Staff record the day-to-day flow of stock. Writing off spoilage and stocktake corrections change
// stock without a matching delivery or sale, so they are restricted to managers.
const MANAGER_ONLY = new Set<string>(["SPOILAGE", "ADJUST"]);

export function movementsRouter(db: () => Pool, log: Logger): Router {
  const router = Router();

  // Record a stock movement. One request can become several ledger rows (a sale that spans batches).
  router.post("/movements", async (req, res) => {
    const m = movementBody.parse(req.body);
    const user = getUser(res);
    if (MANAGER_ONLY.has(m.movementType) && user.role !== "manager") {
      log.warn("authz_denied", {
        user: user.sub,
        role: user.role,
        required: "manager",
        action: `movement:${m.movementType}`,
        requestId: res.locals.requestId,
      });
      throw new HttpError(
        403,
        "FORBIDDEN",
        `Only managers can record ${m.movementType} movements`
      );
    }

    const result = await withTransaction(db(), async (c) => {
      // Serialise all writers for this product, so the stock checks below and the database
      // triggers see one consistent balance.
      const { rows } = await c.query(
        `SELECT unit, shelf_life_days, storage_location FROM products WHERE product_id = $1 FOR UPDATE`,
        [m.productId]
      );
      const product = rows[0] as Product | undefined;
      if (!product)
        throw new HttpError(
          404,
          "PRODUCT_NOT_FOUND",
          `No product ${m.productId}`
        );
      if (product.unit === "unit" && !Number.isInteger(m.quantity)) {
        throw new HttpError(
          422,
          "VALIDATION_ERROR",
          `${m.productId} is counted in whole units`,
          {
            path: "quantity",
          }
        );
      }

      const plan = await planRows(c, m, product);
      const inserted = [];
      for (const r of plan) {
        const ins = await c.query(
          `INSERT INTO stock_movements
             (product_id, movement_type, quantity, batch_id, expiry_date, storage_location, reason, source, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'app', $8)
           RETURNING ${MOVEMENT_COLUMNS}`,
          [
            m.productId,
            m.movementType,
            r.quantity,
            r.batchId,
            r.expiryDate,
            r.storageLocation,
            m.reason ?? null,
            user.sub,
          ]
        );
        inserted.push(ins.rows[0]);
      }
      const onHand = (
        await c.query(
          `SELECT COALESCE(SUM(quantity), 0) AS on_hand FROM stock_movements WHERE product_id = $1`,
          [m.productId]
        )
      ).rows[0].on_hand as number;
      return { movements: inserted, onHand };
    });

    res.status(201).json(result);
  });

  router.get("/movements", async (req, res) => {
    const q = listMovementsQuery.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (q.productId) add("product_id = ?", q.productId);
    if (q.movementType) add("movement_type = ?", q.movementType);
    if (q.beforeId) add("movement_id < ?", q.beforeId);
    params.push(q.limit);
    const { rows } = await db().query(
      `SELECT ${MOVEMENT_COLUMNS} FROM stock_movements
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY movement_id DESC LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  });

  return router;
}
