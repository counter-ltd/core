// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The one error type the API throws on purpose, plus shorthands for minting it.
 *
 * Handlers `throw errors.notFound()` and similar; the central onError handler
 * recognises an AppError and turns it into the right HTTP status and JSON body.
 * Anything that *isn't* an AppError is treated as an unexpected bug and becomes
 * a generic 500, so this type is also the line between "expected" and "we
 * didn't see that coming".
 */
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ERROR_CODES } from '@counter/config';

/**
 * An error that already knows its HTTP status and machine-readable code.
 *
 * Carrying the status and code on the error means a handler can fail from deep
 * in its logic with `throw errors.forbidden()` and trust the response will come
 * out shaped right, no try/catch at the call site.
 */
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

/**
 * Factory shorthands, one per HTTP failure we raise deliberately.
 *
 * The status and code for each are fixed here so they stay consistent across
 * every route; callers only supply a message when the default isn't specific
 * enough.
 */
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
