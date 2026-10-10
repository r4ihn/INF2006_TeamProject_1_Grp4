/** Pure helpers behind the demand chart, kept separate so they can be unit-tested. */

export interface DayValue {
  date: string;
  quantity: number;
}

/** Trailing average over up to `window` days (shorter at the start of the series). */
export function movingAverage(days: DayValue[], window = 7): number[] {
  const out: number[] = [];
  let sum = 0;
  days.forEach((d, i) => {
    sum += d.quantity;
    if (i >= window) sum -= days[i - window]!.quantity;
    out.push(sum / Math.min(i + 1, window));
  });
  return out;
}

/** A "nice" axis maximum at or above `max`: 1, 2, 2.5 or 5 × a power of ten. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= max)!;
  return step * power;
}

/** Indexes of the first day of each month, for x-axis labels. Thinned to at most `max`. */
export function monthStarts(days: DayValue[], max = 12): number[] {
  const starts = days.flatMap((d, i) => (d.date.endsWith('-01') ? [i] : []));
  if (starts.length <= max) return starts;
  const every = Math.ceil(starts.length / max);
  return starts.filter((_, i) => i % every === 0);
}

/** Totals for each week starting Monday (partial first/last weeks included, marked). */
export function weeklyTotals(
  days: DayValue[],
): { weekStarting: string; total: number; days: number }[] {
  const weeks = new Map<string, { total: number; days: number }>();
  for (const d of days) {
    const date = new Date(`${d.date}T00:00:00Z`);
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    const w = weeks.get(key) ?? { total: 0, days: 0 };
    w.total += d.quantity;
    w.days += 1;
    weeks.set(key, w);
  }
  return [...weeks].map(([weekStarting, w]) => ({
    weekStarting,
    total: Math.round(w.total * 1000) / 1000,
    days: w.days,
  }));
}
