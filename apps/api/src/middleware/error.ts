import type { Context } from 'hono';
import { ZodError } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { AppError } from '../lib/errors.ts';
import { ERROR_CODES } from '@counter/config';
import type { ErrorResponse } from '@counter/types';

/** Central error handler — every failure becomes `{ error: { code, message } }`. */
export function onError(err: Error, c: Context): Response {
  if (err instanceof AppError) {
    return c.json<ErrorResponse>({ error: { code: err.code, message: err.message } }, err.status);
  }

  if (err instanceof ZodError) {
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
    { error: { code: ERROR_CODES.INTERNAL, message: 'Something went wrong' } },
    500,
  );
}
