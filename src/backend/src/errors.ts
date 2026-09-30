import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { Logger } from "./logger.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

// SQLSTATEs raised by the triggers in migrations/001_init.sql, and standard constraint failures.
const PG_ERRORS: Record<string, { status: number; code: string }> = {
  CS001: { status: 409, code: "INSUFFICIENT_STOCK" },
  CS002: { status: 405, code: "LEDGER_IS_APPEND_ONLY" },
  CS003: { status: 422, code: "UNKNOWN_BATCH" },
  CS004: { status: 409, code: "INSUFFICIENT_BATCH_STOCK" },
  "23505": { status: 409, code: "CONFLICT" },
  "23503": { status: 422, code: "INVALID_REFERENCE" },
  "23514": { status: 422, code: "CONSTRAINT_VIOLATION" },
};

export const createErrorHandler =
  (log: Logger): ErrorRequestHandler =>
  (err, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof HttpError) {
      res
        .status(err.status)
        .json({ error: err.code, message: err.message, details: err.details });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Request failed validation",
        details: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    if (err?.type === "entity.parse.failed") {
      res.status(400).json({
        error: "INVALID_JSON",
        message: "Request body is not valid JSON",
      });
      return;
    }
    const mapped =
      typeof err?.code === "string" ? PG_ERRORS[err.code] : undefined;
    if (mapped) {
      res
        .status(mapped.status)
        .json({ error: mapped.code, message: err.message });
      return;
    }
    log.error("unhandled_error", {
      requestId: res.locals.requestId,
      code: err?.code,
      message: err?.message,
    });
    res
      .status(500)
      .json({ error: "INTERNAL_ERROR", message: "Unexpected server error" });
  };
