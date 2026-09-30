import { SignJWT } from "jose";
import type { LocalAuthConfig } from "./config.js";
import type { Role } from "./verifier.js";

export interface LocalTokenOptions {
  role: Role;
  sub?: string;
  // Seconds until expiry (default one hour). Negative values make an already-expired token.
  ttlSeconds?: number;
  // Override the cognito:groups claim, e.g. [] for an account with no role.
  groups?: string[];
}

// Mint a development token that looks like a Cognito access token. Used by `npm run token` and
// by the tests; only ever valid against AUTH_MODE=local.
export async function mintLocalToken(
  config: LocalAuthConfig,
  opts: LocalTokenOptions
): Promise<string> {
  const sub = opts.sub ?? `local-${opts.role}`;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    "cognito:groups": opts.groups ?? [opts.role],
    token_use: "access",
    username: sub,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuer(config.issuer)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.ttlSeconds ?? 3600))
    .sign(config.secret);
}
