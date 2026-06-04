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

// Define /trending before /:tag so it isn't captured as a tag name.
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

  // Posts carrying this tag, newest first.
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
