// Who is this user? Access tokens carry the user's id (sub) and groups, but not their email
// or which café they belong to. The first time we see a user we ask Cognito's GetUser API
// (authorised by the user's own access token — no AWS credentials needed on our side).
import type { AuthConfig } from '../config.js';
import type { AccessClaims } from './tokens.js';

export interface UserProfile {
  email: string;
  name?: string;
  /** Slug of the café this user belongs to (Cognito attribute custom:org) */
  orgSlug?: string;
}

export type ProfileFetcher = (accessToken: string, claims: AccessClaims) => Promise<UserProfile>;

export function cognitoProfileFetcher(
  auth: Extract<AuthConfig, { mode: 'cognito' }>,
  fetchImpl: typeof fetch = fetch,
): ProfileFetcher {
  return async (accessToken) => {
    const res = await fetchImpl(`https://cognito-idp.${auth.region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.GetUser',
      },
      body: JSON.stringify({ AccessToken: accessToken }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      UserAttributes?: { Name: string; Value: string }[];
      message?: string;
    };
    if (!res.ok) throw new Error(`Cognito GetUser failed: ${body.message ?? res.status}`);
    const attr = (name: string) => body.UserAttributes?.find((a) => a.Name === name)?.Value;
    const email = attr('email');
    if (!email) throw new Error('Cognito user has no email attribute');
    return { email, name: attr('name'), orgSlug: attr('custom:org') };
  };
}

/** The two built-in development users. */
export const DEV_USERS = {
  staff: {
    sub: 'dev-staff-0000-4000-8000-000000000001',
    email: 'staff@demo.cafe',
    name: 'Sam (staff)',
    groups: ['staff'],
  },
  manager: {
    sub: 'dev-manager-0000-4000-8000-000000000002',
    email: 'manager@demo.cafe',
    name: 'Mia (manager)',
    groups: ['manager'],
  },
} as const;

export const devProfileFetcher: ProfileFetcher = async (_token, claims) => {
  const user = Object.values(DEV_USERS).find((u) => u.sub === claims.sub);
  if (!user) throw new Error(`Unknown development user ${claims.sub}`);
  return { email: user.email, name: user.name };
};
