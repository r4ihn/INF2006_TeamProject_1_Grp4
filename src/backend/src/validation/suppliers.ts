import { z } from 'zod';
import { optionalText } from './common.js';

const fields = {
  name: z
    .string({ error: 'Name is required' })
    .trim()
    .min(1, 'Name is required')
    .max(120, 'Must be at most 120 characters'),
  contactName: optionalText(120),
  email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.email('Enter a valid email address').max(254).nullable().optional(),
  ),
  /** Digits, optionally grouped with spaces and starting with + (e.g. "+65 6123 4567") */
  phone: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z
      .string()
      .trim()
      .max(40, 'Must be at most 40 characters')
      .regex(/^\+?[0-9 ]+$/, 'Use digits only (spaces and a leading + are fine)')
      .refine((v) => {
        const digits = v.replace(/\D/g, '').length;
        return digits >= 8 && digits <= 15;
      }, 'Enter 8 to 15 digits, e.g. +65 6123 4567')
      .nullable()
      .optional(),
  ),
  leadTimeDays: z
    .number({ error: 'Lead time must be a number' })
    .int('Lead time must be a whole number of days')
    .min(0, 'Lead time cannot be negative')
    .max(365, 'Lead time must be 365 days or less'),
  notes: optionalText(1000),
};

// strictObject: unknown keys (e.g. someone trying to send "orgId") are rejected with a 400.
export const createSupplierSchema = z.strictObject({
  ...fields,
  leadTimeDays: fields.leadTimeDays.default(2),
});

export const updateSupplierSchema = z
  .strictObject(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to update' });

export const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
