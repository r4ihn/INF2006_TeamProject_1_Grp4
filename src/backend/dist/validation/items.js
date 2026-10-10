import { z } from 'zod';
import { amount, optionalId, optionalText, queryFlag, requiredText } from './common.js';
const MAX_MONEY = 99_999_999.9999; // NUMERIC(12,4)
const MAX_QTY = 999_999_999.999; // NUMERIC(12,3)
const fields = {
    name: requiredText('Name', 120),
    sku: optionalText(40),
    category: requiredText('Category', 60),
    /** e.g. kg, g, L, ml, pcs, box — free text so cafés can use their own */
    unit: requiredText('Unit', 20),
    supplierId: optionalId,
    unitCost: amount('Unit cost', 4, MAX_MONEY),
    reorderPoint: amount('Reorder point', 3, MAX_QTY),
    spoilageCap: amount('Spoilage cap', 3, MAX_QTY).nullable().optional(),
    isActive: z.boolean({ error: 'Must be true or false' }),
};
// strictObject: unknown keys are rejected — notably `onHand` (only stock counts and
// deliveries change stock, Task 5) and `orgId` (always taken from the request context).
export const createItemSchema = z.strictObject({
    name: fields.name,
    sku: fields.sku,
    category: fields.category,
    unit: fields.unit,
    supplierId: fields.supplierId,
    unitCost: fields.unitCost.default(0),
    reorderPoint: fields.reorderPoint.default(0),
    spoilageCap: fields.spoilageCap,
});
export const updateItemSchema = z
    .strictObject(fields)
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to update' });
export const listItemsQuerySchema = z.object({
    search: z.string().trim().max(120).optional(),
    category: z.string().trim().max(60).optional(),
    supplierId: z.uuid('Invalid supplier id').optional(),
    /** Archived items are hidden unless this is "true" */
    includeArchived: queryFlag,
});
//# sourceMappingURL=items.js.map