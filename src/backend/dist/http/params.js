import { z } from 'zod';
import { notFound } from './errors.js';
const idParamSchema = z.object({ id: z.uuid() });
/** Parses the :id route param. A malformed id can't exist, so it's a 404 rather than a 400. */
export function parseId(req, what) {
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success)
        throw notFound(what);
    return parsed.data.id;
}
/**
 * Human alphabetical order: case-insensitive, "Item 2" before "Item 10".
 * Used instead of SQL ORDER BY because database sort order depends on how Postgres was
 * installed (some put "Zebra" before "apple"). Lists here are tens-to-hundreds of rows.
 */
export const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
export function num(value) {
    return value === null ? null : Number(value.toString());
}
//# sourceMappingURL=params.js.map