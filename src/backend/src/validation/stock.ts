import { z } from 'zod';
import { amount, optionalText } from './common.js';

const MAX_QTY = 999_999_999.999; // NUMERIC(12,3)
const MAX_BACKDATE_DAYS = 90;

/** When it happened. Defaults to now; may be back-dated (e.g. yesterday's delivery), not future. */
const occurredAt = z.iso
  .datetime({ offset: true, error: 'Use a date and time like 2026-09-25T09:30:00+08:00' })
  .optional()
  .transform((v) => (v ? new Date(v) : new Date()))
  .refine((d) => d.getTime() <= Date.now() + 5 * 60_000, 'Can’t be in the future')
  .refine(
    (d) => d.getTime() >= Date.now() - MAX_BACKDATE_DAYS * 86_400_000,
    `Can’t be more than ${MAX_BACKDATE_DAYS} days ago`,
  );

const itemId = z.uuid('Choose an item');

/**
 * A single stock change.
 *   RECEIVE    delivery arrived         quantity > 0, adds to stock
 *   USAGE      used in service          quantity > 0, takes from stock   → counts as demand
 *   WASTE      spoiled / thrown away    quantity > 0, takes from stock
 *   ADJUSTMENT manual correction        quantity ≠ 0, signed (+ adds, − takes)
 * Physical counts go through countSchema instead.
 */
export const movementSchema = z
  .strictObject({
    itemId,
    type: z.enum(['RECEIVE', 'USAGE', 'WASTE', 'ADJUSTMENT'], {
      error: 'Choose delivery, usage, waste or adjustment',
    }),
    quantity: z
      .number({ error: 'Quantity must be a number' })
      .refine(Number.isFinite, 'Quantity must be a number'),
    note: optionalText(500),
    occurredAt,
  })
  .superRefine((v, ctx) => {
    const q = v.quantity;
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', path: ['quantity'], message });
    if (v.type === 'ADJUSTMENT') {
      if (q === 0) issue('An adjustment can’t be zero');
    } else if (q <= 0) {
      issue('Quantity must be more than 0');
    }
    if (Math.abs(q) > MAX_QTY) issue('Quantity is too large');
    if (Math.abs(q * 1000 - Math.round(q * 1000)) > 1e-6) {
      issue('Quantity can have at most 3 decimal places');
    }
  });

/** A stocktake: the counted quantity for one or more items, saved together. */
export const countSchema = z
  .strictObject({
    counts: z
      .array(
        z.strictObject({
          itemId,
          counted: amount('Counted quantity', 3, MAX_QTY),
        }),
        { error: 'Send a list of counts' },
      )
      .min(1, 'Count at least one item')
      .max(500, 'Count at most 500 items at a time'),
    note: optionalText(500),
    occurredAt,
  })
  .refine((v) => new Set(v.counts.map((c) => c.itemId)).size === v.counts.length, {
    path: ['counts'],
    message: 'Each item can only be counted once per stocktake',
  });

export const listMovementsQuerySchema = z.object({
  itemId: z.uuid('Invalid item id').optional(),
  type: z.enum(['RECEIVE', 'USAGE', 'WASTE', 'ADJUSTMENT', 'COUNT']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const demandQuerySchema = z.object({
  itemId: z.uuid('Invalid item id'),
  /** How many days, ending on `to` (default: today in the café's time zone) */
  days: z.coerce.number().int().min(1).max(731).default(14),
  to: z.iso.date('Use a date like 2025-03-23').optional(),
});

export type MovementInput = z.infer<typeof movementSchema>;
export type CountInput = z.infer<typeof countSchema>;
