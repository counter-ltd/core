// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Keyset (cursor) pagination helpers shared by the list endpoints.
 *
 * We page by remembering the last row seen rather than by OFFSET. Keyset stays
 * correct and fast deep into a feed even as rows are inserted or deleted
 * underneath the reader, where OFFSET would skip or repeat items and slow down
 * the further you scroll.
 */
import { and, or, lt, eq, type SQL, type AnyColumn } from '@counter/db';

/**
 * Build the WHERE clause that fetches the page *after* a given cursor.
 *
 * Ordering is newest-first on (createdAt, id). createdAt alone isn't unique, so
 * id is the tiebreaker: take everything strictly older, plus same-timestamp
 * rows with a smaller id. That composite comparison is what makes the boundary
 * exact and stops a row on a timestamp boundary from being shown twice or
 * skipped.
 *
 * @param createdCol  The timestamp column to order by.
 * @param idCol       The unique tiebreaker column.
 * @param cursor      Last row of the previous page, or null for the first page.
 * @param base        Any existing filters to AND the keyset onto.
 * @returns           The combined WHERE, or just `base` on the first page.
 */
export function keysetWhere(
  createdCol: AnyColumn,
  idCol: AnyColumn,
  cursor: { createdAt: Date; id: string } | null,
  base: SQL | undefined,
): SQL | undefined {
  if (!cursor) return base;
  const keyset = or(
    lt(createdCol, cursor.createdAt),
    and(eq(createdCol, cursor.createdAt), lt(idCol, cursor.id)),
  );
  return base ? and(base, keyset) : keyset;
}

/**
 * Split a deliberately over-fetched result into the page and its next cursor.
 *
 * Callers query `limit + 1` rows. The extra row never ships to the client; it
 * exists only to answer "is there another page?" without a second count query.
 * Its presence sets nextCursor; its absence means we've hit the end.
 *
 * @param rows   The rows from a `limit + 1` query.
 * @param limit  The real page size requested.
 * @param getId  Pulls the cursor id out of a row.
 * @returns      The trimmed page and the cursor to fetch the next one (or null).
 */
export function paginate<T>(
  rows: T[],
  limit: number,
  getId: (row: T) => string,
): { data: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return { data, nextCursor: hasMore && last ? getId(last) : null };
}
