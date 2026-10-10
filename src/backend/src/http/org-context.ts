import type { Request } from 'express';

// Which organisation (tenant) is this request acting for?
//
// Every /api route scopes its queries by req.orgId. It is set by requireAuth()
// (src/auth/authenticate.ts) from the signed-in user's record — never from anything the
// client sends — so one café can't read or change another café's data.

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth() for every /api request. */
      orgId?: string;
    }
  }
}

/** The current request's organisation id (throws if requireAuth didn't run — a wiring bug). */
export function orgIdOf(req: Request): string {
  if (!req.orgId) throw new Error('requireAuth middleware is missing on this route');
  return req.orgId;
}
