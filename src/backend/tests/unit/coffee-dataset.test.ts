import { describe, expect, it } from 'vitest';
import { readDataset } from '../../src/import/coffee-dataset.js';
import {
  itemFromIngredient,
  movementNote,
  supplierNames,
} from '../../src/import/import-dataset.js';
import { daysBetween, recentShiftDays } from '../../src/import/shift.js';
import { miniDataset } from '../fixtures/mini-dataset.js';

const replaceLine = (rows: string[], i: number, line: string) =>
  rows.map((r, j) => (j === i ? line : r));

describe('readDataset', () => {
  it('reads the three files and records what they were', () => {
    const d = readDataset(miniDataset());
    expect(d.ingredients.map((i) => i.name)).toEqual(['Fresh milk', 'Paper cup 12oz']);
    expect(d.demand).toHaveLength(6);
    expect(d.ledger).toHaveLength(12);
    expect([d.dateFrom, d.dateTo, d.dayCount]).toEqual(['2024-03-01', '2024-03-03', 3]);
    expect(d.files.map((f) => [f.role, f.file, f.rows])).toEqual([
      ['ingredients', 'ingredients.csv', 2],
      ['demand', 'daily_demand.csv', 6],
      ['ledger', 'stock_movements.csv', 12],
    ]);
    expect(d.files[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.files[1]!.columns).toContain('units');
    expect(d.warnings).toEqual([]);
  });

  it('can skip the ledger', () => {
    const { ingredients, demand } = miniDataset();
    const d = readDataset({ ingredients, demand, ledger: null });
    expect(d.ledger).toBeNull();
    expect(d.files).toHaveLength(2);
  });

  it('keeps the ledger in time order, breaking ties by movement id', () => {
    const m = miniDataset();
    const [header, ...rows] = m.ledger.text.trim().split('\n');
    const shuffled = {
      ...m,
      ledger: { ...m.ledger, text: [header, ...rows.reverse()].join('\n') },
    };
    const d = readDataset(shuffled);
    expect(d.ledger!.map((r) => r.movementId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('refuses sales that don’t add up to daily demand', () => {
    const demand = miniDataset().demand;
    const rows = demand.text.trim().split('\n').slice(1);
    const broken = miniDataset({
      demand: replaceLine(rows, 0, '2024-03-01,1,999,Friday,False,3,Fresh milk,ml'),
    });
    expect(() => readDataset(broken)).toThrow(
      /don’t add up to daily_demand.csv on 1 day\(s\).*Fresh milk on 2024-03-01: 999 in daily_demand.csv, 440 sold/,
    );
  });

  it('books a sale on the café’s calendar day (a late sale stays on its own day)', () => {
    // Movement 5 is at 23:30 on 1 Mar — it must count towards 1 Mar, which it does (440 = 220 + 220)
    expect(() => readDataset(miniDataset())).not.toThrow();
  });

  it('refuses a ledger that takes stock below zero', () => {
    const ledger = miniDataset({
      ledger: [
        '1,2024-03-01 10:00:00.000,1,SELL,-220,B1,,Chiller,1.0,Latte,38.7,card,Counter sale,derived',
      ],
      demand: [
        '2024-03-01,1,220,Friday,False,3,Fresh milk,ml',
        '2024-03-01,2,0,Friday,False,3,Paper cup 12oz,unit',
      ],
    });
    expect(() => readDataset(ledger)).toThrow(
      /movement 1 \(2024-03-01 10:00:00.000\) takes Fresh milk below zero/,
    );
  });

  it.each([
    [
      { ingredients: ['1,ING-001,Fresh milk,ml,0.0021,7,Chiller,1,1000,1 L bottle,3120,4000,x'] },
      /ingredients.csv line 2: avg_daily_demand_derived isn’t a number \(got "x"\)/,
    ],
    [
      {
        ingredients: [
          '1,ING-001,Fresh milk,ml,0.0021,7,Chiller,1,1000,1 L bottle,3120,4000,1',
          '2,ING-001,Oat milk,ml,0.0021,7,Chiller,1,1000,1 L bottle,3120,4000,1',
        ],
      },
      /lists sku "ING-001" twice/,
    ],
    [
      { demand: ['2024-02-30,1,1,,,,,'] },
      /daily_demand.csv line 2: date isn’t a date in YYYY-MM-DD form/,
    ],
    [{ demand: ['2024-03-01,9,1,,,,,'] }, /ingredient_id 9 isn’t in ingredients.csv/],
    [
      { demand: ['2024-03-01,1,1,,,,,', '2024-03-01,1,2,,,,,'] },
      /line 3: ingredient 1 already has a row for 2024-03-01/,
    ],
    [{ demand: ['2024-03-01,1,-1,,,,,'] }, /units must be at least 0/],
    [
      { ledger: ['1,2024-03-01 10:00:00.000,1,STEAL,-1,,,,,,,,,synthetic'] },
      /movement_type "STEAL" isn’t one of RECEIVE, SELL, SPOILAGE, ADJUST/,
    ],
    [
      { ledger: ['1,2024-03-01 10:00:00.000,1,RECEIVE,-5,,,,,,,,,synthetic'] },
      /a RECEIVE movement can’t have quantity -5/,
    ],
    [{ ledger: ['1,soon,1,RECEIVE,5,,,,,,,,,synthetic'] }, /occurred_at "soon" isn’t a date-time/],
  ])('refuses a broken file (%#)', (override, message) => {
    expect(() => readDataset(miniDataset(override))).toThrow(message);
  });

  it('names missing columns', () => {
    const m = miniDataset();
    m.demand.text = 'day,ingredient_id,qty\n2024-03-01,1,1\n';
    expect(() => readDataset(m)).toThrow(
      'daily_demand.csv is missing the columns date, units. It has: day, ingredient_id, qty.',
    );
  });

  it('notes items with missing days instead of treating them as zero', () => {
    const { ingredients, demand } = miniDataset({
      demand: [
        '2024-03-01,1,440,,,,,',
        '2024-03-03,1,200,,,,,',
        '2024-03-01,2,2,,,,,',
        '2024-03-02,2,1,,,,,',
        '2024-03-03,2,1,,,,,',
      ],
    });
    const d = readDataset({ ingredients, demand, ledger: null });
    expect(d.warnings).toEqual([
      'Fresh milk has 1 missing day(s) in daily_demand.csv; they are left out, not treated as zero.',
    ]);
  });
});

describe('mapping to the app', () => {
  const [milk, cups] = readDataset(miniDataset()).ingredients;

  it('turns an ingredient into an item', () => {
    expect(itemFromIngredient(milk!)).toEqual({
      sku: 'ING-001',
      name: 'Fresh milk',
      category: 'Chiller',
      unit: 'ml',
      unitCost: 0.0021,
      reorderPoint: 3120,
      spoilageCap: 746, // half of 7 days × 213.33 ml a day, whole units
    });
    expect(itemFromIngredient(cups!).unit).toBe('pcs');
  });

  it('names one supplier per lead time after how the items are stored', () => {
    const d = readDataset(miniDataset());
    expect([...supplierNames(d.ingredients)]).toEqual([
      [1, 'Chilled goods supplier'],
      [3, 'Dry goods supplier'],
    ]);
    const twoDry = d.ingredients.map((i, n) => ({
      ...i,
      storageLocation: 'Dry Store',
      leadTimeDays: n + 2,
    }));
    expect([...supplierNames(twoDry).values()]).toEqual([
      'Dry goods supplier (2-day)',
      'Dry goods supplier (3-day)',
    ]);
  });

  it('writes readable ledger notes, marking simulated rows', () => {
    const ledger = readDataset(miniDataset()).ledger!;
    expect(ledger.map(movementNote)).toEqual([
      'Opening stock (simulated)',
      'Opening stock (simulated)',
      'Sale #1 — Latte',
      'Sale #1 — Latte',
      'Sale #2 — Latte',
      'Sale #2 — Latte',
      'Stocktake correction (simulated)',
      'Sale #3 — Espresso',
      'Expired, written off (simulated)',
      'Supplier delivery (simulated)',
      'Sale #4 — Hot Chocolate',
      'Sale #4 — Hot Chocolate',
    ]);
  });
});

describe('recentShiftDays', () => {
  it('moves the last date into the 7 days ending yesterday, in whole weeks', () => {
    // Data ends Sun 23 Mar 2025; today Fri 25 Sep 2026 → lands on Sun 20 Sep 2026
    const shift = recentShiftDays('2025-03-23', '2026-09-25');
    expect(shift).toBe(546);
    expect(shift % 7).toBe(0);
    expect(daysBetween('2025-03-23', '2026-09-20')).toBe(546);
  });
  it('is 0 when the data already ends in the last week', () => {
    expect(recentShiftDays('2026-09-18', '2026-09-25')).toBe(0);
    expect(recentShiftDays('2026-09-24', '2026-09-25')).toBe(0);
  });
});
