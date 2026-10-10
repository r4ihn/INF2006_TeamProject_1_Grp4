import { num } from '../http/params.js';
import { isoDate } from '../lib/dates.js';
/** One line per item that has any demand history, by name. */
export async function demandSummary(prisma, orgId) {
    const rows = await prisma.$queryRaw `
    SELECT i.id AS item_id, i.name, i.unit, i.category, i.is_active, i.on_hand::text,
           count(*)::int AS days,
           count(*) FILTER (WHERE d.source = 'IMPORT')::int AS imported_days,
           count(*) FILTER (WHERE d.quantity = 0)::int AS zero_days,
           min(d.date) AS first_date, max(d.date) AS last_date,
           sum(d.quantity)::text AS total
    FROM demand_history d JOIN items i ON i.id = d.item_id
    WHERE d.org_id = ${orgId}::uuid
    GROUP BY i.id`;
    const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
    return rows
        .map((r) => {
        const total = num(r.total);
        return {
            itemId: r.item_id,
            name: r.name,
            unit: r.unit,
            category: r.category,
            isActive: r.is_active,
            onHand: num(r.on_hand),
            days: r.days,
            importedDays: r.imported_days,
            recordedDays: r.days - r.imported_days,
            zeroDays: r.zero_days,
            firstDate: isoDate(r.first_date),
            lastDate: isoDate(r.last_date),
            total,
            averagePerDay: Math.round((total / r.days) * 1000) / 1000,
        };
    })
        .sort((a, b) => byName.compare(a.name, b.name));
}
//# sourceMappingURL=demand.js.map