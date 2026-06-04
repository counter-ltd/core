// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Cross-cutting shapes every endpoint leans on: the error envelope, cursor
 * pagination, and a couple of shared primitives.
 *
 * Keeping these in one place means errors and paged responses look identical no
 * matter which route produced them, so the web app can handle them uniformly.
 */
import { z } from 'zod';
import { PAGINATION, ERROR_CODES } from '@counter/config';

/** The single error shape every endpoint returns on failure. */
export const errorSchema = z.object({
  error: z.object({
    code: z.string(), // stable machine-readable code from ERROR_CODES
    message: z.string(), // human-readable, safe to surface to the user
  }),
});
export type ErrorResponse = z.infer<typeof errorSchema>;

/** Union of every error code in the shared registry, e.g. 'NOT_FOUND'. */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Query params for any paginated list: `?after=<id>&limit=<n>`.
 *
 * Cursor-based, not offset-based, so new rows arriving mid-scroll don't shift
 * the page and cause skips or dupes. `limit` is coerced because query strings
 * arrive as text, and it's clamped to MAX_LIMIT so a caller can't ask for the
 * whole table in one go.
 */
export const paginationQuerySchema = z.object({
  after: z.string().uuid().optional(), // id of the last row seen; omit for page one
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.MAX_LIMIT)
    .default(PAGINATION.DEFAULT_LIMIT),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** One page of results plus the cursor for the next call. */
export interface Page<T> {
  data: T[];
  nextCursor: string | null; // feed this back as `after`; null means no more rows
}

/** Standalone UUID validator, handy for path params and ad-hoc checks. */
export const uuidSchema = z.string().uuid();
