// Minimal Amazon Cognito client for the browser, using Cognito's public JSON API directly
// (the same calls the AWS SDK / Amplify make, without the extra weight).
// Docs: https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/

export interface CognitoSettings {
  region: string;
  clientId: string;
}

export interface CognitoTokens {
  accessToken: string;
  /** Only returned on sign-in, not on refresh */
  refreshToken?: string;
  expiresIn: number;
}

export type SignInResult =
  | { kind: 'signed-in'; tokens: CognitoTokens }
  | { kind: 'new-password-required'; session: string; username: string };

export class CognitoError extends Error {
  constructor(
    public readonly type: string,
    message: string,
  ) {
    super(message);
    this.name = 'CognitoError';
  }
}

/** Friendlier wording for the errors people actually hit. */
function friendly(type: string, message: string): string {
  switch (type) {
    case 'NotAuthorizedException':
      if (/expired/i.test(message)) return 'Your session has expired. Please sign in again.';
      if (/temporary password has expired/i.test(message))
        return 'Your temporary password has expired. Ask the café owner to reset it.';
      return 'Incorrect email or password.';
    case 'UserNotFoundException':
      return 'Incorrect email or password.';
    case 'PasswordResetRequiredException':
      return 'Your password must be reset. Ask the café owner to reset it.';
    case 'InvalidPasswordException':
      return message.replace(/^Password does not conform to policy: /, 'Password: ');
    case 'TooManyRequestsException':
    case 'LimitExceededException':
      return 'Too many attempts. Wait a minute and try again.';
    case 'InvalidParameterException':
      return message;
    default:
      return message || 'Sign-in failed. Please try again.';
  }
}

async function call<T>(settings: CognitoSettings, action: string, body: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://cognito-idp.${settings.region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CognitoError('NetworkError', 'Can’t reach Amazon Cognito. Check your internet.');
  }
  const json = (await res.json().catch(() => ({}))) as { __type?: string; message?: string };
  if (!res.ok) {
    const type = (json.__type ?? 'UnknownError').split('#').pop()!;
    throw new CognitoError(type, friendly(type, json.message ?? ''));
  }
  return json as T;
}

interface AuthResponse {
  AuthenticationResult?: {
    AccessToken: string;
    RefreshToken?: string;
    ExpiresIn: number;
  };
  ChallengeName?: string;
  Session?: string;
  ChallengeParameters?: Record<string, string>;
}

function tokensFrom(r: AuthResponse): CognitoTokens {
  const a = r.AuthenticationResult!;
  return { accessToken: a.AccessToken, refreshToken: a.RefreshToken, expiresIn: a.ExpiresIn };
}

/** Email + password sign-in (USER_PASSWORD_AUTH, over HTTPS). */
export async function signIn(
  settings: CognitoSettings,
  email: string,
  password: string,
): Promise<SignInResult> {
  const r = await call<AuthResponse>(settings, 'InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: settings.clientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  if (r.AuthenticationResult) return { kind: 'signed-in', tokens: tokensFrom(r) };
  if (r.ChallengeName === 'NEW_PASSWORD_REQUIRED' && r.Session) {
    return {
      kind: 'new-password-required',
      session: r.Session,
      username: r.ChallengeParameters?.USER_ID_FOR_SRP ?? email,
    };
  }
  throw new CognitoError(
    r.ChallengeName ?? 'UnsupportedChallenge',
    `This account needs a sign-in step CafeStock doesn’t support (${r.ChallengeName}).`,
  );
}

/** First sign-in with a temporary password: choose a permanent one. */
export async function completeNewPassword(
  settings: CognitoSettings,
  session: string,
  username: string,
  newPassword: string,
): Promise<CognitoTokens> {
  const r = await call<AuthResponse>(settings, 'RespondToAuthChallenge', {
    ChallengeName: 'NEW_PASSWORD_REQUIRED',
    ClientId: settings.clientId,
    Session: session,
    ChallengeResponses: { USERNAME: username, NEW_PASSWORD: newPassword },
  });
  if (!r.AuthenticationResult) {
    throw new CognitoError('UnexpectedResponse', 'Couldn’t finish signing in. Try again.');
  }
  return tokensFrom(r);
}

/** Swap the refresh token for a new access token. */
export async function refresh(
  settings: CognitoSettings,
  refreshToken: string,
): Promise<CognitoTokens> {
  const r = await call<AuthResponse>(settings, 'InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: settings.clientId,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });
  return { ...tokensFrom(r), refreshToken };
}

/** Sign-out: make the refresh token useless (best effort). */
export async function revoke(settings: CognitoSettings, refreshToken: string): Promise<void> {
  await call(settings, 'RevokeToken', { Token: refreshToken, ClientId: settings.clientId }).catch(
    () => undefined,
  );
}
