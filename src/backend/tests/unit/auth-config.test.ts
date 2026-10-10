import { describe, expect, it, vi } from 'vitest';
import { DEV_AUTH, loadConfig } from '../../src/config.js';
import { roleFromGroups } from '../../src/auth/authenticate.js';
import { cognitoProfileFetcher } from '../../src/auth/profile.js';

describe('auth configuration', () => {
  it('defaults to development sign-in when Cognito is not configured', () => {
    expect(loadConfig({}).auth).toEqual({ mode: 'dev', ...DEV_AUTH });
  });

  it('switches to Cognito when the pool and client ids are set', () => {
    expect(
      loadConfig({ COGNITO_USER_POOL_ID: 'us-east-1_AbC123', COGNITO_CLIENT_ID: 'xyz' }).auth,
    ).toEqual({
      mode: 'cognito',
      region: 'us-east-1',
      userPoolId: 'us-east-1_AbC123',
      clientId: 'xyz',
    });
  });

  it('refuses development sign-in in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/not allowed/);
  });

  it('explains missing or malformed Cognito settings', () => {
    expect(() => loadConfig({ AUTH_MODE: 'cognito' })).toThrow(/needs COGNITO_USER_POOL_ID/);
    expect(() => loadConfig({ COGNITO_USER_POOL_ID: 'my-pool', COGNITO_CLIENT_ID: 'x' })).toThrow(
      /looks wrong/,
    );
    expect(() => loadConfig({ AUTH_MODE: 'magic' })).toThrow(/Unknown AUTH_MODE/);
  });
});

describe('roleFromGroups', () => {
  it.each([
    [['manager'], 'MANAGER'],
    [['staff'], 'STAFF'],
    [['staff', 'manager'], 'MANAGER'],
    [['Manager'], 'MANAGER'],
    [['baristas'], null],
    [[], null],
    [undefined, null],
  ])('%j → %s', (groups, role) => {
    expect(roleFromGroups(groups)).toBe(role);
  });
});

describe('cognitoProfileFetcher', () => {
  const auth = {
    mode: 'cognito' as const,
    region: 'us-east-1',
    userPoolId: 'us-east-1_X',
    clientId: 'c',
  };

  it('calls Cognito GetUser with the user’s access token and reads the attributes', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        Username: 'abc',
        UserAttributes: [
          { Name: 'sub', Value: 'abc' },
          { Name: 'email', Value: 'amy@demo.cafe' },
          { Name: 'name', Value: 'Amy' },
          { Name: 'custom:org', Value: 'cafe-b' },
        ],
      }),
    );
    const profile = await cognitoProfileFetcher(auth, fetchImpl as typeof fetch)('TOKEN', {
      sub: 'abc',
      exp: 0,
    });

    expect(profile).toEqual({ email: 'amy@demo.cafe', name: 'Amy', orgSlug: 'cafe-b' });
    expect(fetchImpl).toHaveBeenCalledWith('https://cognito-idp.us-east-1.amazonaws.com/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.GetUser',
      },
      body: JSON.stringify({ AccessToken: 'TOKEN' }),
    });
  });

  it('reports Cognito’s error message', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ message: 'Access Token has been revoked' }, { status: 400 }),
    );
    await expect(
      cognitoProfileFetcher(auth, fetchImpl as typeof fetch)('T', { sub: 's', exp: 0 }),
    ).rejects.toThrow('Access Token has been revoked');
  });
});
