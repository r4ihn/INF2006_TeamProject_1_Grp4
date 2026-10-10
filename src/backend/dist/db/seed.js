// The single organisation used by the demo. Later tasks resolve "the current org"
// from this slug until Cognito login (Task 6) supplies it from the user's token.
export const DEMO_ORG = {
    slug: 'demo-cafe',
    name: 'Demo Café',
    timezone: 'Asia/Singapore',
};
/** Creates the demo organisation, or leaves it as-is if it already exists. Safe to re-run. */
export async function seedDemoOrg(prisma) {
    return prisma.organization.upsert({
        where: { slug: DEMO_ORG.slug },
        update: {},
        create: { ...DEMO_ORG },
    });
}
//# sourceMappingURL=seed.js.map