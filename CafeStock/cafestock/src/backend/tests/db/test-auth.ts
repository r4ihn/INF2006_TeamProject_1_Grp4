import type { Authenticator } from '../../src/auth/authenticate.js';
import type { UserRole } from '../../src/generated/prisma/client.js';
import { HttpError } from '../../src/http/errors.js';

/**
 * Tests that are about suppliers/items/stock (not about signing in) use this instead of
 * real tokens: the org comes from an `x-test-org` header, the role from `x-test-role`
 * (default MANAGER), the user id from `x-test-user`. Sign-in itself is tested in
 * auth-api.test.ts with real, signed tokens.
 */
export const testAuthenticator: Authenticator = async (req) => {
  const orgId = req.header('x-test-org');
  if (!orgId) throw new HttpError(401, 'AUTH_REQUIRED', 'Please sign in.');
  return {
    userId: req.header('x-test-user') ?? null,
    sub: 'test-user',
    email: 'test@example.com',
    name: null,
    role: (req.header('x-test-role') as UserRole | undefined) ?? 'MANAGER',
    orgId,
  };
};
