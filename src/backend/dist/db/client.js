import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
// Prisma 7 talks to Postgres through the `pg` driver via this adapter.
//
// The session time zone is pinned to UTC: the adapter reads and writes timestamps as if the
// server were on UTC, so on a server set to another zone (e.g. a local Postgres on Singapore
// time) every timestamp would silently shift by the offset. Docker's Postgres and RDS default
// to UTC anyway; this makes it true everywhere.
export function createPrismaClient(connectionString) {
    const adapter = new PrismaPg({ connectionString, options: '-c TimeZone=UTC' });
    return new PrismaClient({ adapter });
}
//# sourceMappingURL=client.js.map