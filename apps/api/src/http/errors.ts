import type { ApiErrorCode, ApiErrorResponse } from '@planning-poker/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ConflictError, ValidationError } from '../db/repositories/index.js';

/** Every failure the room API can return, in one shape the browser can switch on. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function notFound(message: string): HttpError {
  return new HttpError(404, 'not_found', message);
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, 'validation_error', message);
}

export function errorBody(code: ApiErrorCode, message: string): ApiErrorResponse {
  return { error: { code, message } };
}

/**
 * Express 4 does not catch a rejected promise from a handler, so an async route that throws
 * would hang the request instead of answering it.
 */
export function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * Translates the data layer's own error types, so routes can call repositories directly and
 * still return a sensible status: a rejected room name is the caller's fault, not ours.
 */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof ValidationError)
    return new HttpError(400, 'validation_error', error.message);
  if (error instanceof ConflictError) return new HttpError(409, 'conflict', error.message);
  // express.json() rejects a malformed body with a SyntaxError carrying the raw `body`.
  if (error instanceof SyntaxError && 'body' in error) {
    return new HttpError(400, 'validation_error', 'request body is not valid JSON');
  }
  return new HttpError(500, 'internal', 'internal server error');
}

export function errorHandler(): (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  return (error, _req, res, _next) => {
    const httpError = toHttpError(error);
    if (httpError.status >= 500) console.error(error);
    res.status(httpError.status).json(errorBody(httpError.code, httpError.message));
  };
}
