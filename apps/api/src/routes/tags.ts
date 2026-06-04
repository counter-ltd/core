// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Hashtag routes: what's trending right now, and the post feed for one tag.
 *
 * Tags live in their own table and link to posts through the postTags join, so
 * both routes here hang off that join rather than scanning post bodies.
 */
import { Hono } from 'hono';
import {
  db,
  posts,
  tags,
  postTags,
  eq,
  and,
  desc,
  sql,
  count,
  inArray,
} from '@counter/db';
import { paginationQuerySchema } from '@counter/types';
import type { Page, Post, TrendingTag } from '@counter/types';
import { query } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { keysetWhere, paginate } from '../lib/cursor.ts';
import { serializePostList } from '../services/serialize.ts';
import type { AppEnv } from '../types.ts';

export const tagRoutes = new Hono<AppEnv>();

// Registered before /:tag, otherwise "trending" would be swallowed by the
// /:tag param and treated as a hashtag named "trending".
//
// Trending = most-used tags over a rolling window. The interval is 168 hours
// (a week) so a tag needs sustained recent use to rank, not a single old burst.
// Deleted posts are joined out so they can't prop up a tag's count.
tagRoutes.get('/trending', async (c) => {
  const rows = await db
    .select({ name: tags.name, value: count(postTags.postId) })
    .from(tags)
    .innerJoin(postTags, eq(postTags.tagId, tags.id))
    .innerJoin(posts, and(eq(posts.id, postTags.postId), eq(posts.deleted, false)))
    .where(sql`${posts.createdAt} > now() - interval '168 hours'`)
    .groupBy(tags.name)
    .orderBy(desc(count(postTags.postId)))
    .limit(20);

  const data: TrendingTag[] = rows.map((r) => ({ name: r.name, postCount: Number(r.value) }));
  return c.json({ data, nextCursor: null });
});

// Post feed for a single tag, newest-first and keyset-paginated. Strip a
// leading '#' and lowercase so "#Coffee" and "coffee" hit the same stored name.
tagRoutes.get('/:tag', async (c) => {
  const viewerId = c.get('userId');
  const name = c.req.param('tag').replace(/^#/, '').toLowerCase();
  const { after, limit } = query(c, paginationQuerySchema);

  const tag = await db.query.tags.findFirst({ where: eq(tags.name, name) });
  if (!tag) throw errors.notFound('Tag not found');

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.posts.findFirst({ where: eq(posts.id, after) });
    if (row) cursor = { createdAt: row.createdAt, id: row.id };
  }

  // Subquery of post ids carrying this tag, used as an IN filter so the post
  // scan stays on the posts table (where the sort keys live) instead of paging
  // through the join.
  const taggedIds = db
    .select({ postId: postTags.postId })
    .from(postTags)
    .where(eq(postTags.tagId, tag.id));

  const base = and(eq(posts.deleted, false), inArray(posts.id, taggedIds));
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
