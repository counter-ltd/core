import { and, or, lt, eq, type SQL, type AnyColumn } from '@counter/db';

/**
 * Build a keyset WHERE for reverse-chronological pagination on (createdAt, id).
 * `cursor` is the last item from the previous page (or null for the first page).
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

/** Slice an over-fetched (+1) result into a page plus its next cursor. */
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
