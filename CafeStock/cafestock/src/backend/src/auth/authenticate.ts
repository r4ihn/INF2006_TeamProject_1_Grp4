// Turns "Authorization: Bearer <access token>" into who the user is, their role, and which
// café (organisation) they act for. Every /api request goes through this.
import type { Request, RequestHandler } from 'express';
import { JwtExpiredError } from 'aws-jwt-verify/error';
import type { PrismaClient } from '../db/client.js';
import { PG, pgErrorCode } from '../db/errors.js';
import type { UserRole } from '../generated/prisma/client.js';
import { HttpError } from '../http/errors.js';
import type { ProfileFetcher } from './profile.js';
import type { AccessClaims, TokenVerifier } from './tokens.js';

export interface AuthContext {
  /** users.id — null only for the test authenticator */
  userId: string | null;
  sub: string;
  email: string;
  name: string | null;
  role: UserRole;
  orgId: string;
}

export type Authenticator = (req: Request) => Promise<AuthContext>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** Cognito groups → app role. Manager wins if someone is in both. */
export function roleFromGroups(groups: string[] | undefined): UserRole | null {
  const g = (groups ?? []).map((x) => x.toLowerCase());
  if (g.includes('manager')) return 'MANAGER';
  if (g.includes('staff')) return 'STAFF';
  return null;
}

const unauthorized = (code: string, message: string) => new HttpError(401, code, message);

export function tokenAuthenticator(opts: {
  prisma: PrismaClient;
  verifier: TokenVerifier;
  fetchProfile: ProfileFetcher;
  defaultOrgSlug: string;
}): Authenticator {
  const { prisma, verifier, fetchProfile, defaultOrgSlug } = opts;

  return async (req) => {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) throw unauthorized('AUTH_REQUIRED', 'Please sign in.');
    const token = match[1]!;

    let claims: AccessClaims;
    try {
      claims = await verifier.verify(token);
    } catch (err) {
      throw err instanceof JwtExpiredError
        ? unauthorized('SESSION_EXPIRED', 'Your session has expired. Please sign in again.')
        : unauthorized(
            'INVALID_TOKEN',
            'Your sign-in could not be verified. Please sign in again.',
          );
    }

    // Authorisation comes from the token's groups on every request, so removing someone
    // from the "manager" group in Cognito takes effect at their next token refresh.
    const role = roleFromGroups(claims['cognito:groups']);
    if (!role) {
      throw new HttpError(
        403,
        'NO_ROLE',
        'Your account has no role yet. Ask the café owner to add you to the staff or manager group.',
      );
    }

    let user = await prisma.user.findUnique({ where: { cognitoSub: claims.sub } });
    if (!user) user = await provisionUser(token, claims, role);
    if (user.role !== role) {
      user = await prisma.user.update({ where: { id: user.id }, data: { role } });
    }

    return {
      userId: user.id,
      sub: claims.sub,
      email: user.email,
      name: user.displayName,
      role,
      orgId: user.orgId,
    };
  };

  /** First sign-in: create (or link) the users row and place the user in their café. */
  async function provisionUser(token: string, claims: AccessClaims, role: UserRole) {
    const profile = await fetchProfile(token, claims);
    const slug = profile.orgSlug?.trim() || defaultOrgSlug;
    const org = await prisma.organization.findUnique({ where: { slug } });
    if (!org) {
      throw new HttpError(
        403,
        'NO_ORG',
        `Your account is linked to café "${slug}", which doesn’t exist here.`,
      );
    }
    const email = profile.email.toLowerCase();
    try {
      // A manager may have added this person by email before their first sign-in: link them.
      return await prisma.user.upsert({
        where: { orgId_email: { orgId: org.id, email } },
        update: { cognitoSub: claims.sub, role, displayName: profile.name ?? undefined },
        create: {
          orgId: org.id,
          email,
          cognitoSub: claims.sub,
          role,
          displayName: profile.name ?? null,
        },
      });
    } catch (err) {
      // Two first requests racing each other: the other one created the row. Use it.
      if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) {
        return prisma.user.findUniqueOrThrow({ where: { cognitoSub: claims.sub } });
      }
      throw err;
    }
  }
}

/** Runs the authenticator; on success sets req.auth (and req.orgId for org scoping). */
export function requireAuth(authenticate: Authenticator): RequestHandler {
  return async (req, _res, next) => {
    const auth = await authenticate(req);
    req.auth = auth;
    req.orgId = auth.orgId;
    next();
  };
}

/** Allows only the given roles (after requireAuth). */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      throw new HttpError(
        403,
        'FORBIDDEN',
        roles.includes('MANAGER') && roles.length === 1
          ? 'Only managers can see this.'
          : 'You don’t have access to this.',
      );
    }
    next();
  };
}

/** The signed-in user (throws if requireAuth didn't run — a wiring bug). */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw new Error('requireAuth middleware is missing on this route');
  return req.auth;
}
