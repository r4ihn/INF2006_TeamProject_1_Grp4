import { describe, expect, it } from 'vitest';
import { monthStarts, movingAverage, niceMax, weeklyTotals } from './chart-data';

const days = (quantities: number[], start = '2025-03-10') =>
  quantities.map((quantity, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), quantity };
  });

describe('chart helpers', () => {
  it('movingAverage uses what is available at the start, then a full window', () => {
    const avg = movingAverage(days([7, 7, 7, 14, 0, 0, 7, 21]));
    // …the last day averages the 7 days before it: (7+7+14+0+0+7+21) / 7 = 8
    [7, 7, 7, 8.75, 7, 35 / 6, 6, 8].forEach((v, k) => expect(avg[k]).toBeCloseTo(v, 9));
    expect(movingAverage(days([2, 4, 6]), 2)).toEqual([2, 3, 5]);
  });

  it('niceMax rounds up to a readable axis top', () => {
    expect([0, 0.3, 7, 12, 180, 240, 2600, 3200].map(niceMax)).toEqual([
      1, 0.5, 10, 20, 200, 250, 5000, 5000,
    ]);
  });

  it('monthStarts finds the 1st of each month and thins them out', () => {
    const year = days(Array(365).fill(1), '2024-03-01');
    expect(monthStarts(year).map((i) => year[i]!.date)).toHaveLength(12);
    expect(monthStarts(year, 4).map((i) => year[i]!.date)).toEqual([
      '2024-03-01',
      '2024-06-01',
      '2024-09-01',
      '2024-12-01',
    ]);
  });

  it('weeklyTotals groups by week starting Monday', () => {
    // Sat 8 Mar → Tue 11 Mar 2025
    expect(weeklyTotals(days([1, 2, 3, 4], '2025-03-08'))).toEqual([
      { weekStarting: '2025-03-03', total: 3, days: 2 },
      { weekStarting: '2025-03-10', total: 7, days: 2 },
    ]);
  });
});
