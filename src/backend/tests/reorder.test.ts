import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";
import { suggestOrder } from "../src/analytics/reorder.js";

const DATA = path.resolve(import.meta.dirname, "../../../data");
const csv = (file: string) =>
  parse(readFileSync(path.join(DATA, file), "utf8"), {
    columns: true,
  }) as Record<string, string>[];

// Test 3 (data/AI validation): the ordering rule reproduces the analytics team's published
// recommendations for every ingredient, from the same inputs they used.
describe("reorder rule vs the analytics team's published output", () => {
  const ingredients = new Map(
    csv("ingredients.csv").map((i) => [i.ingredient_id, i])
  );

  it.each(
    csv("restocking_recommendations.csv").map(
      (r) => [r.ingredient_name, r] as const
    )
  )("%s", (_name, r) => {
    const ing = ingredients.get(r.ingredient_id!)!;
    const got = suggestOrder({
      forecast: Number(r.forecast_next_week),
      safetyStock: Number(r.safety_stock),
      onHand: Number(r.current_stock),
      packSize: Number(ing.pack_size),
      shelfLifeDays: Number(ing.shelf_life_days),
      coverWeeks: 1,
    });
    expect(got.packs).toBe(Number(r.suggested_order_packs));
    expect(got.units).toBe(Number(r.suggested_order_units));
    expect(got.cappedByShelfLife).toBe(r.capped_by_shelf_life === "True");
    expect(got.weeksOfCover).toBe(Number(r.weeks_of_cover_after_order));
  });
});

// Hand-checkable cases a marker can verify on paper.
describe("suggestOrder", () => {
  const base = {
    forecast: 100,
    safetyStock: 25,
    onHand: 40,
    packSize: 50,
    shelfLifeDays: 14,
    coverWeeks: 1,
  };

  it("orders the shortfall in whole packs", () => {
    // need = 100 + 25 = 125; short by 85; ceil(85 / 50) = 2 packs = 100 units; cover (40 + 100) / 100 = 1.4
    expect(suggestOrder(base)).toEqual({
      packs: 2,
      units: 100,
      cappedByShelfLife: false,
      weeksOfCover: 1.4,
    });
  });

  it("orders nothing when stock already covers the need", () => {
    expect(suggestOrder({ ...base, onHand: 125 })).toMatchObject({
      packs: 0,
      units: 0,
      cappedByShelfLife: false,
    });
    expect(suggestOrder({ ...base, onHand: 500 }).packs).toBe(0);
  });

  it("does not order more than a perishable can sell before it expires", () => {
    // 7-day shelf life: at most half a week of forecast sales = floor(10460 * 0.5 / 1000) = 5 packs, although 7 are short
    const milk = {
      forecast: 10460,
      safetyStock: 2170.4,
      onHand: 5700,
      packSize: 1000,
      shelfLifeDays: 7,
      coverWeeks: 1,
    };
    expect(suggestOrder(milk)).toMatchObject({
      packs: 5,
      units: 5000,
      cappedByShelfLife: true,
    });
  });

  it("always allows at least one pack, and handles a zero forecast", () => {
    expect(
      suggestOrder({
        ...base,
        forecast: 10,
        safetyStock: 100,
        onHand: 0,
        shelfLifeDays: 7,
      }).packs
    ).toBe(1);
    const idle = suggestOrder({
      ...base,
      forecast: 0,
      safetyStock: 0,
      onHand: 0,
    });
    expect(idle).toEqual({
      packs: 0,
      units: 0,
      cappedByShelfLife: false,
      weeksOfCover: null,
    });
  });

  it("has no shelf-life limit for items that do not expire", () => {
    const r = suggestOrder({
      ...base,
      shelfLifeDays: null,
      forecast: 1000,
      safetyStock: 0,
      onHand: 0,
      packSize: 10,
    });
    expect(r).toMatchObject({ packs: 100, cappedByShelfLife: false });
  });

  it("responds to live stock: more on hand means a smaller order", () => {
    expect(suggestOrder({ ...base, onHand: 0 }).packs).toBeGreaterThan(
      suggestOrder({ ...base, onHand: 100 }).packs
    );
  });
});
