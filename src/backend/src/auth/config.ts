export type LocalAuthConfig = {
  mode: "local";
  secret: Uint8Array;
  issuer: string;
};
export type CognitoAuthConfig = {
  mode: "cognito";
  region: string;
  userPoolId: string;
  clientId: string;
};
export type AuthConfig = LocalAuthConfig | CognitoAuthConfig;

export const LOCAL_ISSUER = "cafestock-local";

// Read auth settings from the environment. There is deliberately no default mode: a missing or
// unknown AUTH_MODE is an error, so the API can never start unprotected by accident.
export function loadAuthConfig(
  env: NodeJS.ProcessEnv = process.env
): AuthConfig {
  if (env.AUTH_MODE === "local") {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_MODE=local is not allowed when NODE_ENV=production"
      );
    }
    const secret = env.AUTH_LOCAL_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error(
        "AUTH_LOCAL_SECRET must be set to at least 32 characters"
      );
    }
    return {
      mode: "local",
      secret: new TextEncoder().encode(secret),
      issuer: LOCAL_ISSUER,
    };
  }
  if (env.AUTH_MODE === "cognito") {
    const region = env.COGNITO_REGION;
    const userPoolId = env.COGNITO_USER_POOL_ID;
    const clientId = env.COGNITO_CLIENT_ID;
    if (!region || !userPoolId || !clientId) {
      throw new Error(
        "AUTH_MODE=cognito needs COGNITO_REGION, COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID"
      );
    }
    return { mode: "cognito", region, userPoolId, clientId };
  }
  throw new Error(
    'AUTH_MODE must be set to "local" or "cognito" (see .env.example)'
  );
}
