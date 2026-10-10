import { Router } from 'express';
import { authOf } from '../auth/authenticate.js';
/** GET /api/me — who am I, what can I do, which café am I in. */
export function meRouter(prisma) {
    const router = Router();
    router.get('/', async (req, res) => {
        const auth = authOf(req);
        const org = await prisma.organization.findUniqueOrThrow({
            where: { id: auth.orgId },
            select: { id: true, name: true, slug: true, timezone: true },
        });
        res.json({
            user: { id: auth.userId, email: auth.email, name: auth.name, role: auth.role },
            org,
        });
    });
    return router;
}
//# sourceMappingURL=me.js.map