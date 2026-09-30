import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export type LogFields = Record<string, unknown>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

// One JSON object per line on stdout (CloudWatch-friendly). Callers pass only the fields they
// want logged; request bodies, headers and tokens are never logged.
const write =
  (level: string) =>
  (event: string, fields: LogFields = {}) =>
    console.log(
      JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })
    );

export const jsonLogger: Logger = {
  info: write("info"),
  warn: write("warn"),
  error: write("error"),
};

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

// Give every request an id (echoed in X-Request-Id) and log one line when it finishes.
export function requestLogger(log: Logger): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      log.info("request", {
        requestId,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        durationMs: Number((process.hrtime.bigint() - start) / 1_000_000n),
        user: res.locals.user?.sub,
      });
    });
    next();
  };
}
