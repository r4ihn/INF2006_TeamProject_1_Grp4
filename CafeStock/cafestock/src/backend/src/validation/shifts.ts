import { z } from 'zod';
import { isIsoDate } from '../lib/dates.js';
import { optionalId, optionalText, queryFlag, requiredText } from './common.js';

const date = z.string({ error: 'Choose a date' }).refine(isIsoDate, 'Choose a date (YYYY-MM-DD)');
const startTime = z
  .string({ error: 'Enter a start time' })
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 09:00');
/** "24:00" = midnight at the end of the day, for a shift that closes the café */
const endTime = z
  .string({ error: 'Enter an end time' })
  .regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Use a 24-hour time like 17:30');

const fields = {
  date,
  start: startTime,
  end: endTime,
  position: requiredText('Position', 40),
  /** Who works it; null/"" = an open shift */
  userId: optionalId,
  note: optionalText(200),
};

// strictObject: unknown keys (e.g. "orgId", "startsAt") are rejected with a 400.
export const createShiftSchema = z.strictObject(fields);

export const updateShiftSchema = z
  .strictObject(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to update' });

export const listShiftsQuerySchema = z.object({
  /** First day shown; defaults to this week's Monday in the café's time zone */
  from: date.optional(),
  days: z.coerce
    .number({ error: 'days must be a number' })
    .int()
    .min(1, 'days must be 1 to 42')
    .max(42, 'days must be 1 to 42')
    .default(7),
  /** Managers: only my own shifts (staff always get only their own) */
  mine: queryFlag,
});

export const copyWeekSchema = z.strictObject({
  /** Any day in the week to copy (it's rounded to that week's Monday) */
  from: date,
});

export const addTeamMemberSchema = z.strictObject({
  name: requiredText('Name', 80),
  email: z
    .string({ error: 'Email is required' })
    .trim()
    .toLowerCase()
    .pipe(z.email('Enter a valid email address').max(254)),
});

export const updateTeamMemberSchema = z
  .strictObject({
    name: requiredText('Name', 80),
    onRoster: z.boolean({ error: 'onRoster must be true or false' }),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to update' });

export const listTeamQuerySchema = z.object({
  /** Include people removed from the roster */
  all: queryFlag,
});

/** "HH:MM" → minutes after midnight ("24:00" = 1440). */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
}

/**
 * Checks a shift's start and end together (they may come from different requests when
 * editing). Returns field errors, or null when the times make a valid shift.
 */
export function shiftTimeErrors(start: string, end: string): Record<string, string> | null {
  const length = minutesOf(end) - minutesOf(start);
  if (length <= 0) {
    return { end: 'End must be after the start. For a shift that ends at midnight, use 24:00.' };
  }
  if (length < 15) return { end: 'A shift must be at least 15 minutes long' };
  if (length > 16 * 60) return { end: 'A shift can be at most 16 hours long' };
  return null;
}

export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
