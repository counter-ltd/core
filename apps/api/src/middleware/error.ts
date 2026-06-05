// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The single place every thrown error funnels through on its way to the client.
 *
 * Whatever blows up inside a handler, the client gets back the same shape:
 * `{ error: { code, message } }`. That uniformity is the whole point, so the
 * frontend can branch on a stable `code` instead of parsing prose.
 */
import type { Context } from 'hono';
import { ZodError } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { AppError } from '../lib/errors.ts';
import { ERROR_CODES } from '@counter/config';
import type { ErrorResponse } from '@counter/types';

/**
 * Translate any thrown error into the canonical error response.
 *
 * The branches are ordered most-specific to least. Our own `AppError` already
 * carries a code and status, so it passes straight through. Everything else is
 * mapped onto a known code, and anything we didn't anticipate falls to the
 * catch-all 500 with the real error message so bugs surface instead of hiding.
 */
export function onError(err: Error, c: Context): Response {
  if (err instanceof AppError) {
    return c.json<ErrorResponse>({ error: { code: err.code, message: err.message } }, err.status);
  }

  if (err instanceof ZodError) {
    // Surface only the first validation failure. Clients fix one field at a
    // time anyway, and the field path makes the message actionable.
    const first = err.issues[0];
    const path = first?.path.join('.');
    const message = first ? `${path ? path + ': ' : ''}${first.message}` : 'Validation failed';
    return c.json<ErrorResponse>({ error: { code: ERROR_CODES.VALIDATION, message } }, 422);
  }

  if (err instanceof HTTPException) {
    return c.json<ErrorResponse>(
      { error: { code: ERROR_CODES.INTERNAL, message: err.message } },
      err.status,
    );
  }

  console.error('Unhandled error:', err);
  return c.json<ErrorResponse>(
    { error: { code: ERROR_CODES.INTERNAL, message: err.message || 'Internal server error' } },
    500,
  );
}
