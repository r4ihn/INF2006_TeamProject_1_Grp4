import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, CUPS, db, MILK, post, receive, resetDb } from "./helpers.js";

beforeEach(resetDb);

// Test 3 (data validation): a product below its reorder threshold is flagged, others are not.
describe("GET /stock", () => {
  const find = (body: { productId: number }[], id: number) =>
    body.find((s) => s.productId === id);

  it("flags low stock only when strictly below the reorder threshold", async () => {
    await receive(MILK, 2999); // threshold 3000
    await receive(CUPS, 25); // threshold 25: exactly at it is not low

    const { body } = await request(app).get("/stock");
    expect(find(body, MILK)).toMatchObject({
      onHand: 2999,
      reorderThreshold: 3000,
      isLow: true,
    });
    expect(find(body, CUPS)).toMatchObject({ onHand: 25, isLow: false });

    await post({ productId: CUPS, movementType: "SELL", quantity: 1 });
    expect(find((await request(app).get("/stock")).body, CUPS).isLow).toBe(
      true
    );
  });

  it("filters to low stock only", async () => {
    await receive(MILK, 5000);
    const { body } = await request(app)
      .get("/stock")
      .query({ lowOnly: "true" });
    expect(body.map((s: { productId: number }) => s.productId)).toEqual([CUPS]);
  });

  it("reports products with no movements as zero stock", async () => {
    const { body } = await request(app).get("/stock");
    expect(body).toHaveLength(2);
    expect(body.every((s: { onHand: number }) => s.onHand === 0)).toBe(true);
  });

  it("reports the earliest expiry and any stock that is past its date", async () => {
    await db().query(
      `INSERT INTO stock_movements (product_id, movement_type, quantity, batch_id, expiry_date, occurred_at)
       VALUES ($1, 'RECEIVE', 40, 'OLD', '2020-01-10', '2020-01-01'),
              ($1, 'RECEIVE', 60, 'NEW', '2099-01-10', '2020-01-01')`,
      [MILK]
    );
    const item = find(
      (await request(app).get("/stock")).body,
      MILK
    ) as unknown as Record<string, unknown>;
    expect(item).toMatchObject({
      onHand: 100,
      earliestExpiry: "2020-01-10",
      expiredQuantity: 40,
    });
  });

  it("rejects a bad filter", async () => {
    expect(
      (await request(app).get("/stock").query({ lowOnly: "maybe" })).status
    ).toBe(400);
  });
});

describe("catalogue endpoints", () => {
  it("lists suppliers and products", async () => {
    const suppliers = await request(app).get("/suppliers");
    expect(suppliers.body).toEqual([
      expect.objectContaining({ name: "Test Supplier" }),
    ]);
    const products = await request(app).get("/products");
    expect(products.body.map((p: { sku: string }) => p.sku)).toEqual([
      "T-CUPS",
      "T-MILK",
    ]);
  });

  it("gets one product, 404 when missing, 400 for a bad id", async () => {
    expect((await request(app).get(`/products/${MILK}`)).body).toMatchObject({
      sku: "T-MILK",
      unit: "ml",
    });
    expect((await request(app).get("/products/999")).status).toBe(404);
    expect((await request(app).get("/products/abc")).status).toBe(400);
  });
});
