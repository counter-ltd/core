import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ERROR_CODES } from '@counter/config';

/** A thrown error that maps cleanly to the `{ error: { code, message } }` shape. */
export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  validation: (message = 'Invalid request') =>
    new AppError(422, ERROR_CODES.VALIDATION, message),
  unauthorized: (message = 'Authentication required') =>
    new AppError(401, ERROR_CODES.UNAUTHORIZED, message),
  forbidden: (message = 'You do not have permission to do that') =>
    new AppError(403, ERROR_CODES.FORBIDDEN, message),
  notFound: (message = 'Not found') => new AppError(404, ERROR_CODES.NOT_FOUND, message),
  conflict: (message = 'Already exists') => new AppError(409, ERROR_CODES.CONFLICT, message),
  rateLimited: (message = 'Too many requests') =>
    new AppError(429, ERROR_CODES.RATE_LIMITED, message),
  internal: (message = 'Something went wrong') =>
    new AppError(500, ERROR_CODES.INTERNAL, message),
};
