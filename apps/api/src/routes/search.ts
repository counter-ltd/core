// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Search across posts, users, and tags.
 *
 * Every search is a case-insensitive substring match (ILIKE), kept simple on
 * purpose. Results come back newest-first and keyset-paginated, the same way
 * the rest of the feed does, so search and feed cursors behave alike.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { db, posts, users, tags, eq, and, or, desc, ilike } from '@counter/db';
import { paginationQuerySchema } from '@counter/types';
import type { Page, Post, PublicUser } from '@counter/types';
import { query } from '../lib/validate.ts';
import { keysetWhere, paginate } from '../lib/cursor.ts';
import { serializePostList, serializeUsers } from '../services/serialize.ts';
import type { AppEnv } from '../types.ts';

/** Hono router for the /search group. Mounts /posts, /users, and /tags handlers. */
export const searchRoutes = new Hono<AppEnv>();

const searchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100),
});

/**
 * Wrap a query in `%…%` for a substring LIKE, escaping the wildcard characters
 * first. Without the escape a user searching for "50%" or "a_b" would have the
 * %, _, and \ read as wildcards and match far more than they typed.
 */
function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

// Body substring search over live posts. viewerId is read optionally (search is
// open to logged-out users) and passed through so serialization can mark the
// viewer's own likes/reposts when they are signed in.
searchRoutes.get('/posts', async (c) => {
  const viewerId = c.get('userId');
  const { q, after, limit } = query(c, searchQuerySchema);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.posts.findFirst({ where: eq(posts.id, after) });
    if (row) cursor = { createdAt: row.createdAt, id: row.id };
  }

  // Exclude soft-deleted posts, then match the body. keysetWhere layers the
  // pagination cursor on top of this base predicate.
  const base = and(eq(posts.deleted, false), ilike(posts.body, likeContains(q)));
  const where = keysetWhere(posts.createdAt, posts.id, cursor, base);
  const rows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(where)
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit + 1);

  const { data: idRows, nextCursor } = paginate(rows, limit, (r) => r.id);
  const data = await serializePostList(
    idRows.map((r) => r.id),
    viewerId,
  );
  return c.json<Page<Post>>({ data, nextCursor });
});

// User search matches on either handle or display name, so a query finds people
// whether they typed the @username or the human-readable name.
searchRoutes.get('/users', async (c) => {
  const viewerId = c.get('userId');
  const { q, after, limit } = query(c, searchQuerySchema);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.users.findFirst({ where: eq(users.id, after) });
    if (row) cursor = { createdAt: row.createdAt, id: row.id };
  }

  const term = likeContains(q);
  const base = or(ilike(users.username, term), ilike(users.displayName, term));
  const where = keysetWhere(users.createdAt, users.id, cursor, base);
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(limit + 1);

  const { data: idRows, nextCursor } = paginate(rows, limit, (r) => r.id);
  const userMap = await serializeUsers(
    idRows.map((r) => r.id),
    viewerId,
  );
  // serializeUsers returns a map; rebuild the ordered list from it and drop any
  // id that didn't resolve so the page keeps its newest-first order.
  const data = idRows.map((r) => userMap.get(r.id)).filter((u): u is PublicUser => !!u);
  return c.json<Page<PublicUser>>({ data, nextCursor });
});

// Tag autocomplete. Unpaginated (just a capped list of names) since it feeds a
// type-ahead, not a browsable feed.
searchRoutes.get('/tags', async (c) => {
  const { q, limit } = query(c, searchQuerySchema);
  // Strip a leading '#' so "#coffee" and "coffee" search the same stored name.
  const term = likeContains(q.replace(/^#/, ''));
  const rows = await db
    .select({ name: tags.name })
    .from(tags)
    .where(ilike(tags.name, term))
    .orderBy(desc(tags.createdAt))
    .limit(limit);
  return c.json({ data: rows.map((r) => r.name), nextCursor: null });
});
