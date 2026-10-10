import { Router } from 'express';
import { orgIdOf } from '../http/org-context.js';
import { isoDate } from '../lib/dates.js';
/** GET /api/imports — the organisation's dataset imports (provenance), newest first. */
export function importsRouter(prisma) {
    const router = Router();
    router.get('/', async (req, res) => {
        const rows = await prisma.datasetImport.findMany({
            where: { orgId: orgIdOf(req) },
            orderBy: { importedAt: 'desc' },
            take: 20,
        });
        res.json(rows.map(({ orgId: _orgId, dateFrom, dateTo, ...r }) => ({
            ...r,
            dateFrom: isoDate(dateFrom),
            dateTo: isoDate(dateTo),
        })));
    });
    return router;
}
//# sourceMappingURL=imports.js.map