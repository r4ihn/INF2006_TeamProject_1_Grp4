// Formatted by hand so it's "S$" on every computer (browsers disagree between "$" and "SGD").
// Cents, plus up to 2 more places for ingredients costed per g or ml (S$0.0021)
const money = new Intl.NumberFormat('en-SG', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const quantity = new Intl.NumberFormat('en-SG', { maximumFractionDigits: 3 });

/** 32.5 → "S$32.50", 0.0021 → "S$0.0021" */
export function formatMoney(value: number): string {
  return `S$${money.format(value)}`;
}

/** (2.5, "kg") → "2.5 kg" */
export function formatQty(value: number, unit?: string): string {
  return unit ? `${quantity.format(value)} ${unit}` : quantity.format(value);
}

/** Parses a number input's text: "" → null, "abc" → NaN, "2.5" → 2.5 */
export function parseNumber(text: string): number | null {
  const t = text.trim();
  return t === '' ? null : Number(t);
}

/** True if `value` has at most `places` decimal places. */
export function hasAtMostDecimals(value: number, places: number): boolean {
  const scaled = value * 10 ** places;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

const dateTime = new Intl.DateTimeFormat('en-SG', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const shortDate = new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'short' });
const weekday = new Intl.DateTimeFormat('en-SG', { weekday: 'short' });
const longDate = new Intl.DateTimeFormat('en-SG', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const monthName = new Intl.DateTimeFormat('en-SG', { month: 'short' });

const dateTimeWithYear = new Intl.DateTimeFormat('en-SG', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "25 Sep, 9:30 am" this year; "23 Mar 2025, 6:11 pm" for other years */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return (d.getFullYear() === new Date().getFullYear() ? dateTime : dateTimeWithYear).format(d);
}

/** "2026-09-25" → "25 Sep" (calendar date, no time-zone shifting) */
export function formatDay(isoDate: string): string {
  return shortDate.format(new Date(`${isoDate}T12:00:00`));
}

/** "2026-09-25" → "Fri" */
export function formatWeekday(isoDate: string): string {
  return weekday.format(new Date(`${isoDate}T12:00:00`));
}

/** 2.5 → "+2.5", -1 → "−1" (true minus sign), 0 → "0" */
export function formatSigned(value: number, unit?: string): string {
  const abs = formatQty(Math.abs(value), unit);
  if (value > 0) return `+${abs}`;
  if (value < 0) return `−${abs}`;
  return abs;
}

/** "2024-03-01" → "1 Mar 2024" */
export function formatLongDate(isoDate: string): string {
  return longDate.format(new Date(`${isoDate}T12:00:00`));
}

/** "2024-03-01" → "Mar" */
export function formatMonth(isoDate: string): string {
  return monthName.format(new Date(`${isoDate}T12:00:00`));
}
