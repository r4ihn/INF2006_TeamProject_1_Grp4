/**
 * Calendar date ("YYYY-MM-DD") of an instant in a given time zone.
 * A usage recorded at 1:30am Singapore time on 25 Sep is 24 Sep in UTC — demand must be
 * booked on the café's own calendar day, so we always convert with the org's time zone.
 */
export function dateInTimeZone(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** "YYYY-MM-DD" → Date at UTC midnight, the form Prisma expects for DATE columns. */
export function dbDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** Date column value → "YYYY-MM-DD". */
export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" shifted by whole days. */
export function addDays(isoDateStr: string, days: number): string {
  const d = dbDate(isoDateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** Milliseconds the zone's wall clock is ahead of UTC at `instant` (Singapore: +8h). */
function zoneOffsetMs(instant: number, timeZone: string): number {
  let fmt = offsetFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    offsetFormatters.set(timeZone, fmt);
  }
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(instant)).map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const wall = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
    parts.second!,
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

/**
 * A café's local wall-clock time ("2024-03-01 10:15:50.520") → the real instant, using the
 * org's time zone. Returns null if the text isn't a date-time in that form.
 */
export function localTimeToInstant(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/.exec(
    local.trim(),
  );
  if (!m) return null;
  const [y, mo, d, h, mi, s = '0', ms = '0'] = m.slice(1);
  const asUtc = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s, +ms.padEnd(3, '0'));
  const check = new Date(asUtc);
  if (check.getUTCDate() !== +d! || check.getUTCMonth() !== +mo! - 1 || +h! > 23) return null;
  // Two passes so times near a daylight-saving change land on the right side of it
  const first = asUtc - zoneOffsetMs(asUtc, timeZone);
  return new Date(asUtc - zoneOffsetMs(first, timeZone));
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return (
    d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!
  );
}
