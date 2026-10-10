import { addDays, dbDate } from '../lib/dates.js';

/** Whole days from a to b (b − a), for "YYYY-MM-DD" dates. */
export function daysBetween(a: string, b: string): number {
  return Math.round((dbDate(b).getTime() - dbDate(a).getTime()) / 86_400_000);
}

/**
 * Days to add so a history ending on `dateTo` ends within the 7 days up to yesterday.
 * Always a multiple of 7, so every date keeps its weekday — and the weekly pattern the
 * forecast learns from.
 */
export function recentShiftDays(dateTo: string, today: string): number {
  return Math.floor(daysBetween(dateTo, addDays(today, -1)) / 7) * 7;
}
