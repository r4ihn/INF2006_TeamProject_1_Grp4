import request from "supertest";
import { expect } from "vitest";
import { createApp } from "../src/app.js";
import { getPool } from "../src/db/pool.js";

export const app = createApp();
export const db = () => getPool();

export const MILK = 1; // ml, shelf life 7 days, reorder threshold 3000
export const CUPS = 2; // whole units, shelf life 730 days, reorder threshold 25

// Wipe the test database and load two products. Refuses to touch anything not named *_test.
export async function resetDb(): Promise<void> {
  const { rows } = await db().query("SELECT current_database() AS name");
  expect(rows[0].name).toMatch(/_test$/);
  await db().query(
    "TRUNCATE stock_movements, products, suppliers RESTART IDENTITY CASCADE"
  );
  await db().query("SELECT setval('batch_id_seq', 1, false)");
  await db().query("INSERT INTO suppliers (name) VALUES ('Test Supplier')");
  await db().query(
    `INSERT INTO products (sku, name, unit, shelf_life_days, storage_location, supplier_id,
                           reorder_threshold, reorder_quantity)
     VALUES ('T-MILK', 'Milk', 'ml', 7, 'Chiller', 1, 3000, 4000),
            ('T-CUPS', 'Cups', 'unit', 730, 'Dry Store', 1, 25, 50)`
  );
}

export interface MovementInput {
  productId: number;
  movementType: "RECEIVE" | "SELL" | "SPOILAGE" | "ADJUST";
  quantity: number;
  batchId?: string;
  expiryDate?: string;
  reason?: string;
}

export const post = (body: unknown) =>
  request(app)
    .post("/movements")
    .send(body as object);

// Receive stock and return the new batch id.
export async function receive(
  productId: number,
  quantity: number,
  expiryDate?: string
): Promise<string> {
  const res = await post({
    productId,
    movementType: "RECEIVE",
    quantity,
    expiryDate,
  });
  expect(res.status).toBe(201);
  return res.body.movements[0].batchId;
}

export async function onHand(productId: number): Promise<number> {
  const { rows } = await db().query(
    "SELECT COALESCE(SUM(quantity), 0) AS n FROM stock_movements WHERE product_id = $1",
    [productId]
  );
  return rows[0].n;
}
