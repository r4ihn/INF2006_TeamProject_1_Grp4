// Central place for reading environment configuration.
export const DEFAULT_DATABASE_URL = 'postgresql://cafestock:cafestock@localhost:5433/cafestock';
/** Identifiers used for development-mode tokens (never a real AWS pool). */
export const DEV_AUTH = {
    region: 'lo-local-1', // looks like a Cognito region (the verifier checks the format) but isn't real
    userPoolId: 'lo-local-1_CafeStockDev',
    clientId: 'cafestock-dev-client',
};
export function loadConfig(env = process.env) {
    const port = Number(env.PORT ?? 3000);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid PORT: "${env.PORT}"`);
    }
    const corsOrigins = (env.CORS_ORIGIN ?? 'http://localhost:5173')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    const nodeEnv = env.NODE_ENV ?? 'development';
    return {
        port,
        corsOrigins,
        nodeEnv,
        databaseUrl: env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
        demoOrgSlug: env.DEMO_ORG_SLUG ?? 'demo-cafe',
        auth: loadAuthConfig(env, nodeEnv),
        staticDir: env.STATIC_DIR?.trim() || null,
    };
}
function loadAuthConfig(env, nodeEnv) {
    const userPoolId = env.COGNITO_USER_POOL_ID?.trim();
    const clientId = env.COGNITO_CLIENT_ID?.trim();
    const requested = env.AUTH_MODE?.trim().toLowerCase();
    const mode = requested || (userPoolId && clientId ? 'cognito' : 'dev');
    if (mode === 'cognito') {
        if (!userPoolId || !clientId) {
            throw new Error('AUTH_MODE=cognito needs COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID (see docs/cognito-setup.md)');
        }
        if (!/^[a-z]{2}-[a-z]+-\d_[0-9a-zA-Z]+$/.test(userPoolId)) {
            throw new Error(`COGNITO_USER_POOL_ID looks wrong: "${userPoolId}" (e.g. us-east-1_AbC123xyz)`);
        }
        const region = env.COGNITO_REGION?.trim() || userPoolId.split('_')[0];
        return { mode: 'cognito', region, userPoolId, clientId };
    }
    if (mode === 'dev') {
        if (nodeEnv === 'production') {
            throw new Error('Development login (AUTH_MODE=dev) is not allowed when NODE_ENV=production');
        }
        return { mode: 'dev', ...DEV_AUTH };
    }
    throw new Error(`Unknown AUTH_MODE "${requested}" — use "cognito" or "dev"`);
}
//# sourceMappingURL=config.js.map