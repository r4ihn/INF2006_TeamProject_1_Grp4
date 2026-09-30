import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";
import { asManager, db, post, resetDb } from "./helpers.js";

describe("demo dataset", () => {
  beforeAll(async () => {
    await resetDb();
    await seed(db(), { reset: true });
  }, 60_000);

  it("loads the whole ledger, and the ledger rules accept all of it", async () => {
    const { rows } = await db().query(
      "SELECT count(*)::int AS n FROM stock_movements"
    );
    expect(rows[0].n).toBe(17049);
  });

  it("derives the same current stock the analytics team computed", async () => {
    const { body } = await asManager().get("/stock");
    const byName = Object.fromEntries(
      body.map((s: { name: string; onHand: number }) => [s.name, s.onHand])
    );
    expect(byName).toEqual({
      "Espresso beans": 1559,
      "Fresh milk": 5700,
      "Drinking chocolate": 224,
      "Cocoa powder": 257,
      "Paper cup 8oz": 7,
      "Paper cup 12oz": 66,
      "Cup lid 12oz": 117,
      Napkin: 65,
    });
    const low = body
      .filter((s: { isLow: boolean }) => s.isLow)
      .map((s: { name: string }) => s.name);
    expect(low.sort()).toEqual([
      "Drinking chocolate",
      "Napkin",
      "Paper cup 8oz",
    ]);
  });

  it("keeps provenance on every seeded row", async () => {
    const { rows } = await db().query(
      "SELECT source, count(*)::int AS n FROM stock_movements GROUP BY source"
    );
    expect(Object.fromEntries(rows.map((r) => [r.source, r.n]))).toEqual({
      derived: 16743,
      synthetic: 306,
    });
    const { rows: traced } = await db().query(
      "SELECT count(*)::int AS n FROM stock_movements WHERE source = 'derived' AND sale_id IS NULL"
    );
    expect(traced[0].n).toBe(0);
  });

  it("accepts new movements on top of the seeded ledger, continuing batch numbering", async () => {
    const res = await post({
      productId: 8,
      movementType: "RECEIVE",
      quantity: 250,
    });
    expect(res.status).toBe(201);
    expect(res.body.movements[0].batchId).toBe("B000253");
    expect(res.body.onHand).toBe(315);
  });

  it("refuses to reseed a populated ledger unless told to reset", async () => {
    await expect(seed(db())).rejects.toThrow(/not empty/);
  });
});

describe("migrations", () => {
  it("are idempotent", async () => {
    expect(await migrate(db())).toEqual([]);
  });
});
