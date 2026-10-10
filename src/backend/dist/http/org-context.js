/** The current request's organisation id (throws if requireAuth didn't run — a wiring bug). */
export function orgIdOf(req) {
    if (!req.orgId)
        throw new Error('requireAuth middleware is missing on this route');
    return req.orgId;
}
//# sourceMappingURL=org-context.js.map