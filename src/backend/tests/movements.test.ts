import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  app,
  CUPS,
  db,
  MILK,
  onHand,
  post,
  receive,
  resetDb,
} from "./helpers.js";

beforeEach(resetDb);

// Test 1 (functional workflow): record movements end to end and check the resulting stock.
describe("recording stock movements", () => {
  it("receive then sell leaves the right stock, derived from the ledger", async () => {
    await receive(MILK, 1000);
    const sale = await post({
      productId: MILK,
      movementType: "SELL",
      quantity: 300,
    });

    expect(sale.status).toBe(201);
    expect(sale.body.onHand).toBe(700);
    expect(sale.body.movements).toHaveLength(1);
    expect(sale.body.movements[0]).toMatchObject({
      movementType: "SELL",
      quantity: -300,
      source: "app",
    });

    const stock = await request(app).get("/stock");
    expect(
      stock.body.find((s: { productId: number }) => s.productId === MILK).onHand
    ).toBe(700);

    const ledger = await request(app)
      .get("/movements")
      .query({ productId: MILK });
    expect(ledger.body.map((m: { quantity: number }) => m.quantity)).toEqual([
      -300, 1000,
    ]);
  });

  it("defaults the expiry of a received batch from the product's shelf life", async () => {
    const res = await post({
      productId: MILK,
      movementType: "RECEIVE",
      quantity: 500,
    });
    const expected = new Date(Date.now() + 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(res.body.movements[0].expiryDate).toBe(expected);
    expect(res.body.movements[0].batchId).toBe("B000001");
    expect(res.body.movements[0].storageLocation).toBe("Chiller");
  });

  it("sells first-expiry-first-out across batches", async () => {
    const later = await receive(MILK, 100, "2099-01-10");
    const sooner = await receive(MILK, 50, "2099-01-05");

    const sale = await post({
      productId: MILK,
      movementType: "SELL",
      quantity: 70,
    });
    expect(sale.status).toBe(201);
    expect(
      sale.body.movements.map((m: { batchId: string; quantity: number }) => [
        m.batchId,
        m.quantity,
      ])
    ).toEqual([
      [sooner, -50],
      [later, -20],
    ]);

    const batches = await request(app).get(`/products/${MILK}/batches`);
    expect(batches.body).toEqual([
      expect.objectContaining({ batchId: later, remaining: 80 }),
    ]);
  });

  it("writes off spoilage and stocktake corrections against a named batch", async () => {
    const batch = await receive(MILK, 100, "2099-01-01");

    const spoil = await post({
      productId: MILK,
      movementType: "SPOILAGE",
      quantity: 30,
      batchId: batch,
      reason: "Split",
    });
    expect(spoil.body.onHand).toBe(70);

    const down = await post({
      productId: MILK,
      movementType: "ADJUST",
      quantity: -5,
      batchId: batch,
      reason: "Recount",
    });
    expect(down.body.onHand).toBe(65);
    const up = await post({
      productId: MILK,
      movementType: "ADJUST",
      quantity: 10,
      batchId: batch,
      reason: "Recount",
    });
    expect(up.body.onHand).toBe(75);
    expect(up.body.movements[0].expiryDate).toBe("2099-01-01");
  });

  it("lists movements newest first with paging", async () => {
    for (let i = 0; i < 3; i++) await receive(CUPS, 10 + i);
    const page1 = await request(app).get("/movements").query({ limit: 2 });
    expect(page1.body.map((m: { quantity: number }) => m.quantity)).toEqual([
      12, 11,
    ]);
    const page2 = await request(app)
      .get("/movements")
      .query({ limit: 2, beforeId: page1.body[1].movementId });
    expect(page2.body.map((m: { quantity: number }) => m.quantity)).toEqual([
      10,
    ]);
  });
});

describe("business rules", () => {
  it("rejects a sale larger than the stock and leaves the ledger untouched", async () => {
    await receive(MILK, 100);
    const res = await post({
      productId: MILK,
      movementType: "SELL",
      quantity: 101,
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: "INSUFFICIENT_STOCK",
      details: { onHand: 100, requested: 101 },
    });
    expect(await onHand(MILK)).toBe(100);
  });

  it("rejects spoilage larger than the named batch even when other batches could cover it", async () => {
    const small = await receive(MILK, 10, "2099-01-01");
    await receive(MILK, 500, "2099-02-01");
    const res = await post({
      productId: MILK,
      movementType: "SPOILAGE",
      quantity: 50,
      batchId: small,
      reason: "x",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("INSUFFICIENT_BATCH_STOCK");
  });

  it("rejects movements against an unknown batch or product", async () => {
    await receive(MILK, 10);
    const batch = await post({
      productId: MILK,
      movementType: "SPOILAGE",
      quantity: 1,
      batchId: "NOPE",
      reason: "x",
    });
    expect(batch.status).toBe(422);
    expect(batch.body.error).toBe("UNKNOWN_BATCH");

    const product = await post({
      productId: 999,
      movementType: "RECEIVE",
      quantity: 1,
    });
    expect(product.status).toBe(404);
    expect(product.body.error).toBe("PRODUCT_NOT_FOUND");
  });

  it("rejects receiving stock that is already expired", async () => {
    const res = await post({
      productId: MILK,
      movementType: "RECEIVE",
      quantity: 10,
      expiryDate: "2020-01-01",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("ALREADY_EXPIRED");
  });

  it("rejects a duplicate batch id for the same product", async () => {
    const batch = await receive(MILK, 10, "2099-01-01");
    const res = await post({
      productId: MILK,
      movementType: "RECEIVE",
      quantity: 5,
      batchId: batch,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("CONFLICT");
  });

  it("rejects fractional quantities for products counted in whole units", async () => {
    const res = await post({
      productId: CUPS,
      movementType: "RECEIVE",
      quantity: 2.5,
    });
    expect(res.status).toBe(422);
  });
});

describe("input validation", () => {
  const invalid: [string, object][] = [
    [
      "zero quantity",
      { productId: MILK, movementType: "RECEIVE", quantity: 0 },
    ],
    ["negative sale", { productId: MILK, movementType: "SELL", quantity: -5 }],
    [
      "zero adjustment",
      {
        productId: MILK,
        movementType: "ADJUST",
        quantity: 0,
        batchId: "B1",
        reason: "x",
      },
    ],
    [
      "unknown movement type",
      { productId: MILK, movementType: "STEAL", quantity: 5 },
    ],
    ["missing product", { movementType: "RECEIVE", quantity: 5 }],
    [
      "string quantity",
      { productId: MILK, movementType: "RECEIVE", quantity: "5" },
    ],
    [
      "too many decimals",
      { productId: MILK, movementType: "RECEIVE", quantity: 1.2345 },
    ],
    [
      "absurdly large quantity",
      { productId: MILK, movementType: "RECEIVE", quantity: 1e12 },
    ],
    [
      "unexpected field",
      {
        productId: MILK,
        movementType: "RECEIVE",
        quantity: 5,
        source: "derived",
      },
    ],
    [
      "bad expiry date",
      {
        productId: MILK,
        movementType: "RECEIVE",
        quantity: 5,
        expiryDate: "tomorrow",
      },
    ],
    [
      "expiry on a sale",
      {
        productId: MILK,
        movementType: "SELL",
        quantity: 5,
        expiryDate: "2099-01-01",
      },
    ],
    [
      "spoilage without batch",
      { productId: MILK, movementType: "SPOILAGE", quantity: 5, reason: "x" },
    ],
    [
      "spoilage without reason",
      { productId: MILK, movementType: "SPOILAGE", quantity: 5, batchId: "B1" },
    ],
    [
      "overlong reason",
      {
        productId: MILK,
        movementType: "RECEIVE",
        quantity: 5,
        reason: "x".repeat(201),
      },
    ],
  ];

  it.each(invalid)("400 for %s", async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    expect(await onHand(MILK)).toBe(0);
  });

  it("400 for malformed JSON", async () => {
    const res = await request(app)
      .post("/movements")
      .set("Content-Type", "application/json")
      .send("{oops");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_JSON");
  });

  it("cannot forge ledger provenance through the API", async () => {
    const res = await post({
      productId: MILK,
      movementType: "RECEIVE",
      quantity: 5,
      source: "derived",
    });
    expect(res.status).toBe(400);
  });
});

describe("append-only ledger", () => {
  it("refuses UPDATE and DELETE at the database, whoever issues them", async () => {
    await receive(MILK, 100);
    await expect(
      db().query("UPDATE stock_movements SET quantity = 999999")
    ).rejects.toMatchObject({ code: "CS002" });
    await expect(
      db().query("DELETE FROM stock_movements")
    ).rejects.toMatchObject({ code: "CS002" });
    expect(await onHand(MILK)).toBe(100);
  });

  it("refuses rows with the wrong sign for their type", async () => {
    const batch = await receive(MILK, 100);
    await expect(
      db().query(
        "INSERT INTO stock_movements (product_id, movement_type, quantity, batch_id) VALUES ($1, 'SELL', 5, $2)",
        [MILK, batch]
      )
    ).rejects.toMatchObject({ code: "23514" });
  });
});

// Test 4 (concurrency): simultaneous sales must never spend the same stock twice.
describe("concurrent writers", () => {
  it("through the API: only as many sales succeed as the stock can cover", async () => {
    await receive(MILK, 100);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        post({ productId: MILK, movementType: "SELL", quantity: 30 })
      )
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect(await onHand(MILK)).toBe(10);
  });

  it("directly in SQL, bypassing the API: the database trigger still serialises them", async () => {
    const batch = await receive(MILK, 100);
    const attempt = () =>
      db().query(
        `INSERT INTO stock_movements (product_id, movement_type, quantity, batch_id)
         VALUES ($1, 'SELL', -30, $2)`,
        [MILK, batch]
      );
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, attempt)
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );
    expect(failures.every((f) => f.reason.code === "CS001")).toBe(true);
    expect(await onHand(MILK)).toBe(10);
  });

  it("does not let one product's sales block or corrupt another's", async () => {
    await receive(MILK, 60);
    await receive(CUPS, 60);
    const results = await Promise.all(
      [MILK, CUPS].flatMap((p) =>
        Array.from({ length: 4 }, () =>
          post({ productId: p, movementType: "SELL", quantity: 20 })
        )
      )
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(6);
    expect(await onHand(MILK)).toBe(0);
    expect(await onHand(CUPS)).toBe(0);
  });
});
