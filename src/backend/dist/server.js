import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPrismaClient } from './db/client.js';
// Load backend/.env if present (Node's built-in loader — no dotenv needed).
try {
    process.loadEnvFile();
}
catch {
    // No .env file — fall back to defaults / real environment variables.
}
const config = loadConfig();
const prisma = createPrismaClient(config.databaseUrl);
const app = createApp({ config, prisma });
const server = app.listen(config.port, () => {
    console.log(`CafeStock API listening on http://localhost:${config.port}`);
    console.log(config.auth.mode === 'cognito'
        ? `Sign-in: Amazon Cognito (${config.auth.userPoolId})`
        : 'Sign-in: development mode (pick staff or manager — see docs/cognito-setup.md for Cognito)');
});
// Friendly early warning if the database isn't reachable (the API still starts).
prisma.$queryRaw `SELECT to_regclass('public.organizations') IS NOT NULL AS ready`.then(([row]) => row?.ready
    ? console.log('Database connected')
    : console.warn('Database connected, but its tables are missing — run `npm run db:setup`.'), () => console.warn('Database NOT reachable — is Docker Desktop running? Try `npm run db:setup`.'));
// Graceful shutdown — matters on EC2 when the Auto Scaling Group replaces instances.
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        console.log(`${signal} received, shutting down…`);
        server.close(() => {
            void prisma.$disconnect().finally(() => process.exit(0));
        });
    });
}
//# sourceMappingURL=server.js.map