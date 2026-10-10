import type { ShiftInput } from '../api';
import { isIsoDate, minutesOf } from './dates';

/** Suggested positions; anything else the café uses is added from its existing shifts. */
export const COMMON_POSITIONS = ['Barista', 'Cashier', 'Kitchen', 'Service', 'Opening', 'Closing'];

export type ShiftErrors = Partial<Record<keyof ShiftInput | 'form', string>>;

/** The same checks as the API, so most mistakes are caught before anything is sent. */
export function validateShift(v: ShiftInput): ShiftErrors {
  const errors: ShiftErrors = {};
  if (!isIsoDate(v.date)) errors.date = 'Choose a date';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.start)) errors.start = 'Enter a start time';
  if (!/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(v.end)) errors.end = 'Enter an end time';
  if (!errors.start && !errors.end) {
    const length = minutesOf(v.end) - minutesOf(v.start);
    if (length <= 0) errors.end = 'End must be after the start';
    else if (length < 15) errors.end = 'A shift must be at least 15 minutes long';
    else if (length > 16 * 60) errors.end = 'A shift can be at most 16 hours long';
  }
  if (!v.position.trim()) errors.position = 'Position is required';
  return errors;
}
