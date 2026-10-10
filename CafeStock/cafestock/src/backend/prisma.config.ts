// Prisma CLI configuration (Prisma 7+). Used by `prisma generate`, `prisma migrate …`,
// `prisma db seed` and `prisma studio` — not by the running API.
import { defineConfig } from 'prisma/config';

// Load backend/.env if it exists (Prisma 7 no longer does this automatically).
try {
  process.loadEnvFile();
} catch {
  // No .env — the default below matches docker-compose.yml.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Keep this default in sync with DEFAULT_DATABASE_URL in src/config.ts
    url: process.env.DATABASE_URL ?? 'postgresql://cafestock:cafestock@localhost:5433/cafestock',
  },
});
