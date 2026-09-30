import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  app,
  as,
  asManager,
  CUPS,
  db,
  logs,
  MILK,
  receive,
  resetDb,
} from "./helpers.js";

const evaluation = {
  accuracy: {
    method: "MA-2",
    mase: 0.963,
    baselineMethod: "Naive (last week)",
    baselineMase: 1,
  },
  simulatedYear: {
    serviceZ: 1.65,
    withoutForecast: { serviceLevel: 0.9165, stockoutDays: 264 },
    withForecast: { serviceLevel: 0.9542, stockoutDays: 172 },
  },
};

async function addRun(
  forecastMilk: number,
  evalJson: object = evaluation
): Promise<number> {
  const run = await db().query(
    `INSERT INTO forecast_runs (method, as_of, service_z, cover_weeks, source, evaluation)
     VALUES ('MA-2', '2025-03-23', 1.65, 1, 'test', $1) RETURNING run_id`,
    [evalJson]
  );
  const id = run.rows[0].run_id;
  await db().query(
    `INSERT INTO reorder_recommendations
       (run_id, product_id, forecast_next_week, safety_stock, stock_at_run, suggested_order_packs,
        suggested_order_units, capped_by_shelf_life, weeks_of_cover_after_order, method_mase)
     VALUES ($1, $2, $3, 500, 100, 9, 9000, false, 1.0, 1.072)`,
    [id, MILK, forecastMilk]
  );
  return id;
}

beforeEach(async () => {
  await resetDb();
  logs.length = 0;
});

describe("GET /recommendations access", () => {
  it("needs a token", async () => {
    expect((await request(app).get("/recommendations")).status).toBe(401);
  });

  it("is manager-only: staff get 403 and the denial is logged", async () => {
    const res = await as("staff").get("/recommendations");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FORBIDDEN");
    expect(logs.find((l) => l.event === "authz_denied")?.fields).toMatchObject({
      user: "test-staff",
      role: "staff",
      required: "manager",
    });
  });
});

describe("GET /recommendations content", () => {
  it("is empty before any forecast has been loaded", async () => {
    const res = await asManager().get("/recommendations");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ run: null, items: [] });
  });

  it("returns the published numbers plus an order recomputed from live stock", async () => {
    await addRun(4000);
    await receive(MILK, 1000, "2099-01-01");
    const res = await asManager().get("/recommendations");

    expect(res.body.run).toMatchObject({
      method: "MA-2",
      asOf: "2025-03-23",
      serviceZ: 1.65,
      coverWeeks: 1,
    });
    expect(res.body.run.evaluation.accuracy.mase).toBe(0.963);
    expect(res.body.items).toHaveLength(1);
    const milk = res.body.items[0];
    expect(milk).toMatchObject({
      productId: MILK,
      name: "Milk",
      packDescription: "1 L bottle",
      onHand: 1000,
      forecastNextWeek: 4000,
      safetyStock: 500,
      stockAtRun: 100,
      methodMase: 1.072,
      published: { packs: 9, units: 9000 },
    });
    // need = 4000 + 500 = 4500; short by 3500 -> 4 packs; shelf-life cap floor(4000 * 0.5 / 1000) = 2 packs
    expect(milk.suggested).toEqual({
      packs: 2,
      units: 2000,
      cappedByShelfLife: true,
      weeksOfCover: 0.8,
    });
  });

  it("updates the suggestion as stock changes, leaving the published figures alone", async () => {
    await addRun(1000);
    const before = (await asManager().get("/recommendations")).body.items[0];
    expect(before.suggested.packs).toBe(1); // nothing on hand: need 1500 -> 2 packs, capped to floor(1000*0.5/1000)=0 -> min 1

    await receive(MILK, 5000, "2099-01-01");
    const after = (await asManager().get("/recommendations")).body.items[0];
    expect(after.onHand).toBe(5000);
    expect(after.suggested.packs).toBe(0);
    expect(after.published).toEqual(before.published);
  });

  it("uses only the newest forecast run", async () => {
    await addRun(1000);
    await addRun(2500);
    const { body } = await asManager().get("/recommendations");
    expect(body.run.runId).toBe(2);
    expect(
      body.items.map((i: { forecastNextWeek: number }) => i.forecastNextWeek)
    ).toEqual([2500]);
  });

  it("copes with a product that has no pack size or shelf life", async () => {
    await addRun(1000);
    await db().query(
      "UPDATE products SET pack_size = NULL, shelf_life_days = NULL WHERE product_id = $1",
      [MILK]
    );
    await receive(CUPS, 10);
    const res = await asManager().get("/recommendations");
    expect(res.status).toBe(200);
    expect(res.body.items[0].suggested).toMatchObject({
      cappedByShelfLife: false,
    });
    expect(Number.isFinite(res.body.items[0].suggested.packs)).toBe(true);
  });
});
