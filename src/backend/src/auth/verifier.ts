import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from "jose";
import type { AuthConfig } from "./config.js";

export type Role = "staff" | "manager";

export interface AuthUser {
  sub: string;
  username: string;
  role: Role;
}

export type AuthFailure = "invalid_token" | "expired_token" | "no_role";

export class AuthError extends Error {
  constructor(
    readonly reason: AuthFailure,
    message: string
  ) {
    super(message);
  }
}

export type Verifier = (token: string) => Promise<AuthUser>;

// Both token sources produce the same claims as an Amazon Cognito access token, so everything
// after verification is identical in local development and in the cloud:
//   sub, username, token_use = "access", and "cognito:groups" = ["staff"] or ["manager"].
export function createVerifier(config: AuthConfig): Verifier {
  if (config.mode === "local") {
    return (token) =>
      toUser(() =>
        jwtVerify(token, config.secret, {
          issuer: config.issuer,
          algorithms: ["HS256"],
        })
      );
  }
  const issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
  const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return (token) =>
    toUser(
      () => jwtVerify(token, keys, { issuer, algorithms: ["RS256"] }),
      (payload) => payload.client_id === config.clientId
    );
}

async function toUser(
  verify: () => Promise<{ payload: JWTPayload }>,
  extraCheck: (payload: JWTPayload) => boolean = () => true
): Promise<AuthUser> {
  let payload: JWTPayload;
  try {
    ({ payload } = await verify());
  } catch (err) {
    if (err instanceof errors.JWTExpired)
      throw new AuthError("expired_token", "Token has expired");
    throw new AuthError("invalid_token", "Token is invalid");
  }
  // Only access tokens are accepted (not ID tokens), and only for this app's client.
  if (
    payload.token_use !== "access" ||
    typeof payload.sub !== "string" ||
    !extraCheck(payload)
  ) {
    throw new AuthError("invalid_token", "Token is invalid");
  }

  const raw = payload["cognito:groups"];
  const groups = Array.isArray(raw)
    ? raw.filter((g): g is string => typeof g === "string")
    : [];
  const role: Role | undefined = groups.includes("manager")
    ? "manager"
    : groups.includes("staff")
      ? "staff"
      : undefined;
  if (!role) throw new AuthError("no_role", "Account has no role assigned");

  const username =
    typeof payload.username === "string" ? payload.username : payload.sub;
  return { sub: payload.sub, username, role };
}
