import { z } from 'zod';
import { PAGINATION, ERROR_CODES } from '@counter/config';

/** Consistent error envelope returned by every endpoint on failure. */
export const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof errorSchema>;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Cursor-based pagination query: ?after=<id>&limit=<n>. */
export const paginationQuerySchema = z.object({
  after: z.string().uuid().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.MAX_LIMIT)
    .default(PAGINATION.DEFAULT_LIMIT),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** A page of results plus the cursor to fetch the next page (null when exhausted). */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export const uuidSchema = z.string().uuid();
