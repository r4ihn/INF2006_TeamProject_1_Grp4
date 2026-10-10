import type { SupplierInput } from '../api';

export type SupplierErrors = Partial<Record<keyof SupplierInput | 'form', string>>;

/** What a phone field accepts while typing: digits, spaces, and + only at the start. */
export function cleanPhone(text: string): string {
  const kept = text.replace(/[^\d+ ]/g, '');
  return kept.startsWith('+') ? `+${kept.slice(1).replace(/\+/g, '')}` : kept.replace(/\+/g, '');
}

/** Same rules as the API (backend/src/validation/suppliers.ts), checked early for quick feedback. */
export function validateSupplier(v: SupplierInput): SupplierErrors {
  const e: SupplierErrors = {};
  if (!v.name.trim()) e.name = 'Name is required';
  else if (v.name.trim().length > 120) e.name = 'Must be at most 120 characters';
  if (v.contactName.length > 120) e.contactName = 'Must be at most 120 characters';
  if (v.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()))
    e.email = 'Enter a valid email address';
  const phone = v.phone.trim();
  if (phone.length > 40) e.phone = 'Must be at most 40 characters';
  else if (phone && !/^\+?[0-9 ]+$/.test(phone))
    e.phone = 'Use digits only (spaces and a leading + are fine)';
  else if (phone) {
    const digits = phone.replace(/\D/g, '').length;
    if (digits < 8 || digits > 15) e.phone = 'Enter 8 to 15 digits, e.g. +65 6123 4567';
  }
  if (!Number.isInteger(v.leadTimeDays))
    e.leadTimeDays = 'Lead time must be a whole number of days';
  else if (v.leadTimeDays < 0) e.leadTimeDays = 'Lead time cannot be negative';
  else if (v.leadTimeDays > 365) e.leadTimeDays = 'Lead time must be 365 days or less';
  if (v.notes.length > 1000) e.notes = 'Must be at most 1000 characters';
  return e;
}
