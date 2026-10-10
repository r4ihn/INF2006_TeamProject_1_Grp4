import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import { PG, pgErrorCode } from '../db/errors.js';

/**
 * Every error response has the same shape, so the frontend can handle them uniformly:
 *   { "error": { "code": "VALIDATION_ERROR", "message": "…", "fields": { "name": "…" } } }
 */
export interface ErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

/** Throw this from a route to send a specific status + message. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);

/** 404 for any route nobody handled. */
export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ErrorBody = {
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  };
  res.status(404).json(body);
};

/** Turns any thrown error into a JSON response. Never leaks stack traces to the client. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const send = (status: number, code: string, message: string, fields?: Record<string, string>) => {
    const body: ErrorBody = { error: { code, message, ...(fields ? { fields } : {}) } };
    res.status(status).json(body);
  };

  if (err instanceof HttpError) return send(err.status, err.code, err.message, err.fields);

  if (err instanceof z.ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.length ? issue.path.join('.') : '_';
      fields[key] ??= issue.message;
    }
    return send(400, 'VALIDATION_ERROR', 'Some fields are invalid', fields);
  }

  // Malformed JSON body (thrown by express.json())
  if ((err as { type?: string }).type === 'entity.parse.failed') {
    return send(400, 'INVALID_JSON', 'Request body is not valid JSON');
  }

  // Prisma "record to update/delete not found"
  if ((err as { code?: string }).code === 'P2025')
    return send(404, 'NOT_FOUND', 'Resource not found');

  switch (pgErrorCode(err)) {
    case PG.UNIQUE_VIOLATION:
      return send(409, 'CONFLICT', 'That value is already in use');
    case PG.FOREIGN_KEY_VIOLATION:
      return send(409, 'IN_USE', 'This record is still referenced by other records');
    case PG.CHECK_VIOLATION:
      return send(400, 'VALIDATION_ERROR', 'A value is out of the allowed range');
    case PG.UNDEFINED_TABLE:
      console.error('Database tables are missing — run `npm run db:setup`.');
      return send(
        503,
        'SCHEMA_MISSING',
        'The database tables haven’t been created yet. Run: npm run db:setup',
      );
  }

  console.error(err);
  // While developing, say what actually broke (saves a trip to the terminal).
  // In production (NODE_ENV=production) the client only gets the generic message.
  const detail =
    process.env.NODE_ENV !== 'production' && err instanceof Error ? lastLine(err.message) : '';
  return send(
    500,
    'INTERNAL',
    detail ? `Server error: ${detail}` : 'Something went wrong on the server',
  );
};

/** Prisma messages are long and multi-line; the last line is the useful part. */
function lastLine(message: string): string {
  const lines = message
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return (lines.at(-1) ?? '').slice(0, 300);
}
