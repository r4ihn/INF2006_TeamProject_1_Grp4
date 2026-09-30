import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import type pg from "pg";
import { loadEnv } from "../env.js";
import { closePool, getPool, withTransaction } from "./pool.js";

const DEFAULT_DATA_DIR = path.resolve(import.meta.dirname, "../../../../data");
const BATCH_SIZE = 500;

// The dataset has no suppliers, so these are invented (clearly fictional) for the demo.
const SUPPLIERS = [
  { name: "Harbour Roasters (demo)", email: "orders@harbour-roasters.example" },
  { name: "Green Meadow Dairy (demo)", email: "orders@green-meadow.example" },
  { name: "PackWell Supplies (demo)", email: "orders@packwell.example" },
];
const SUPPLIER_BY_SKU: Record<string, string> = {
  "ING-001": SUPPLIERS[0]!.name,
  "ING-003": SUPPLIERS[0]!.name,
  "ING-004": SUPPLIERS[0]!.name,
  "ING-002": SUPPLIERS[1]!.name,
  "ING-005": SUPPLIERS[2]!.name,
  "ING-006": SUPPLIERS[2]!.name,
  "ING-007": SUPPLIERS[2]!.name,
  "ING-008": SUPPLIERS[2]!.name,
};

type Row = Record<string, string>;

function readCsv(dir: string, file: string): Row[] {
  return parse(readFileSync(path.join(dir, file), "utf8"), {
    columns: true,
    skip_empty_lines: true,
  }) as Row[];
}

const blank = (v: string | undefined): string | null =>
  v === undefined || v === "" ? null : v;

export interface SeedResult {
  suppliers: number;
  products: number;
  movements: number;
}

// Load the synthetic demo dataset (data/) into an empty database. Refuses to run on a database that
// already holds a ledger unless reset is true, which wipes products, suppliers and movements first.
export async function seed(
  db: pg.Pool,
  opts: { dataDir?: string; reset?: boolean } = {}
): Promise<SeedResult> {
  const dir = opts.dataDir ?? process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
  const ingredients = readCsv(dir, "ingredients.csv");
  const movements = readCsv(dir, "stock_movements.csv").sort(
    (a, b) =>
      a.occurred_at!.localeCompare(b.occurred_at!) ||
      Number(a.movement_id) - Number(b.movement_id)
  );

  return withTransaction(db, async (c) => {
    if (opts.reset) {
      await c.query(
        "TRUNCATE stock_movements, products, suppliers RESTART IDENTITY CASCADE"
      );
    } else if (
      (await c.query("SELECT 1 FROM stock_movements LIMIT 1")).rowCount
    ) {
      throw new Error(
        "Ledger is not empty; run with --reset to wipe and reseed"
      );
    }

    const supplierIds = new Map<string, number>();
    for (const s of SUPPLIERS) {
      const r = await c.query(
        "INSERT INTO suppliers (name, contact_email) VALUES ($1, $2) RETURNING supplier_id",
        [s.name, s.email]
      );
      supplierIds.set(s.name, r.rows[0].supplier_id);
    }

    for (const i of ingredients) {
      await c.query(
        `INSERT INTO products
           (product_id, sku, name, unit, unit_cost, shelf_life_days, storage_location, supplier_id,
            lead_time_days, pack_size, pack_description, reorder_threshold, reorder_quantity)
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          i.ingredient_id,
          i.sku,
          i.ingredient_name,
          i.unit,
          i.unit_cost,
          i.shelf_life_days,
          i.storage_location,
          supplierIds.get(SUPPLIER_BY_SKU[i.sku!] ?? ""),
          i.lead_time_days,
          i.pack_size,
          i.pack_description,
          i.reorder_threshold,
          i.reorder_quantity,
        ]
      );
    }
    await c.query(
      "SELECT setval(pg_get_serial_sequence('products', 'product_id'), (SELECT max(product_id) FROM products))"
    );

    const cols = [
      "movement_id", "occurred_at", "product_id", "movement_type", "quantity", "batch_id",
      "expiry_date", "storage_location", "sale_id", "caused_by_drink", "sale_price",
      "payment_method", "reason", "source",
    ]; // prettier-ignore
    for (let start = 0; start < movements.length; start += BATCH_SIZE) {
      const chunk = movements.slice(start, start + BATCH_SIZE);
      const params: (string | null)[] = [];
      const tuples = chunk.map((m, r) => {
        params.push(
          m.movement_id!,
          m.occurred_at!,
          m.ingredient_id!,
          m.movement_type!,
          m.quantity!,
          m.batch_id!,
          blank(m.expiry_date),
          blank(m.storage_location),
          blank(m.sale_id),
          blank(m.caused_by_drink),
          blank(m.sale_price),
          blank(m.payment_method),
          blank(m.reason),
          m.source!
        );
        const p = r * cols.length;
        // Dataset timestamps carry no zone; they are stored as UTC.
        return `($${p + 1}, ($${p + 2})::timestamp AT TIME ZONE 'UTC', ${cols
          .slice(2)
          .map((_, k) => `$${p + 3 + k}`)
          .join(", ")})`;
      });
      await c.query(
        `INSERT INTO stock_movements (${cols.join(", ")}) OVERRIDING SYSTEM VALUE VALUES ${tuples.join(", ")}`,
        params
      );
    }
    await c.query(
      "SELECT setval(pg_get_serial_sequence('stock_movements', 'movement_id'), (SELECT max(movement_id) FROM stock_movements))"
    );
    // Continue the dataset's B000123-style batch numbering for batches created through the API.
    await c.query(
      `SELECT setval('batch_id_seq', COALESCE((SELECT max(substring(batch_id from '^B(\\d+)$')::int) FROM stock_movements), 1))`
    );

    return {
      suppliers: SUPPLIERS.length,
      products: ingredients.length,
      movements: movements.length,
    };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnv();
  seed(getPool(), { reset: process.argv.includes("--reset") })
    .then((r) =>
      console.log(
        `Seeded ${r.suppliers} suppliers, ${r.products} products, ${r.movements} movements`
      )
    )
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(closePool);
}
