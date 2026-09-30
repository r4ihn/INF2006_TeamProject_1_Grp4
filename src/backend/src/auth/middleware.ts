import type { RequestHandler, Response } from "express";
import { HttpError } from "../errors.js";
import type { Logger } from "../logger.js";
import {
  AuthError,
  type AuthUser,
  type Role,
  type Verifier,
} from "./verifier.js";

export function getUser(res: Response): AuthUser {
  return res.locals.user as AuthUser;
}

// Require a valid bearer token on everything mounted after this. Failures are logged (reason only,
// never the token) so repeated failed logins can be monitored.
export function authenticate(verify: Verifier, log: Logger): RequestHandler {
  return async (req, res, next) => {
    const token = /^Bearer +(\S+)$/i.exec(req.get("authorization") ?? "")?.[1];
    const deny = (
      reason: string,
      status: number,
      code: string,
      message: string
    ): never => {
      log.warn("auth_failed", {
        reason,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        requestId: res.locals.requestId,
      });
      if (status === 401) res.set("WWW-Authenticate", "Bearer");
      throw new HttpError(status, code, message);
    };

    if (!token)
      return deny(
        "missing_token",
        401,
        "UNAUTHENTICATED",
        "Authentication required"
      );
    try {
      res.locals.user = await verify(token);
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.reason === "expired_token")
          return deny(err.reason, 401, "TOKEN_EXPIRED", err.message);
        if (err.reason === "no_role")
          return deny(err.reason, 403, "NO_ROLE", err.message);
      }
      return deny(
        "invalid_token",
        401,
        "UNAUTHENTICATED",
        "Authentication required"
      );
    }
    next();
  };
}

const RANK: Record<Role, number> = { staff: 1, manager: 2 };

// Allow a route only for users whose role is at least `required` (a manager can do anything staff can).
export function requireRole(required: Role, log: Logger): RequestHandler {
  return (req, res, next) => {
    const user = getUser(res);
    if (RANK[user.role] < RANK[required]) {
      log.warn("authz_denied", {
        user: user.sub,
        role: user.role,
        required,
        action: `${req.method} ${req.originalUrl.split("?")[0]}`,
        requestId: res.locals.requestId,
      });
      throw new HttpError(403, "FORBIDDEN", `This needs the ${required} role`);
    }
    next();
  };
}
