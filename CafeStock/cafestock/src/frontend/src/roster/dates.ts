// Calendar helpers for the roster. Dates are "YYYY-MM-DD" strings in the café's time zone;
// the arithmetic runs on UTC midnights so the browser's own time zone never shifts a day.

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Today's date in the café's time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday on or before the date (weeks run Monday to Sunday). */
export function mondayOf(iso: string): string {
  return addDays(iso, -((utc(iso).getUTCDay() + 6) % 7));
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = utc(value);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Fixed English short names (browsers disagree on "Sep" vs "Sept")
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-06" → "Tue 6 Oct" */
export function dayHeading(iso: string): string {
  const d = utc(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Monday → "5 – 11 Oct 2026", "28 Sep – 4 Oct 2026" or "29 Dec 2025 – 4 Jan 2026". */
export function weekLabel(monday: string): string {
  const a = utc(monday);
  const b = utc(addDays(monday, 6));
  const dm = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const end = `${dm(b)} ${b.getUTCFullYear()}`;
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${dm(a)} ${a.getUTCFullYear()} – ${end}`;
  if (a.getUTCMonth() !== b.getUTCMonth()) return `${dm(a)} – ${end}`;
  return `${a.getUTCDate()} – ${end}`;
}

/** First day of the month containing the date. */
export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Same day-of-month-1 anchor, `delta` months away ("2026-10-15", 1 → "2026-11-01"). */
export function addMonths(iso: string, delta: number): string {
  const d = utc(monthStart(iso));
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 10);
}

/** First cell of a Monday-first month grid: the Monday on or before the 1st. */
export function monthGridStart(iso: string): string {
  return mondayOf(monthStart(iso));
}

export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "2026-10-15" → "October 2026" */
export function monthLabel(iso: string): string {
  const d = utc(iso);
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Mon", "Tue" … for a date. */
export function weekdayShort(iso: string): string {
  return WEEKDAYS[utc(iso).getUTCDay()] ?? '';
}

/** 6 → "6 h", 4.5 → "4.5 h", 7.75 → "7.75 h" */
export function formatHours(hours: number): string {
  return `${Number(hours.toFixed(2))} h`;
}

/** "HH:MM" → minutes after midnight ("24:00" = 1440). */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
