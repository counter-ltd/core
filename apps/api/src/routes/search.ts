import { Hono } from 'hono';
import { z } from 'zod';
import { db, posts, users, tags, eq, and, or, desc, ilike } from '@counter/db';
import { paginationQuerySchema } from '@counter/types';
import type { Page, Post, PublicUser } from '@counter/types';
import { query } from '../lib/validate.ts';
import { keysetWhere, paginate } from '../lib/cursor.ts';
import { serializePostList, serializeUsers } from '../services/serialize.ts';
import type { AppEnv } from '../types.ts';

export const searchRoutes = new Hono<AppEnv>();

const searchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100),
});

/** Escape LIKE wildcards so user input matches literally. */
function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

searchRoutes.get('/posts', async (c) => {
  const viewerId = c.get('userId');
  const { q, after, limit } = query(c, searchQuerySchema);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.posts.findFirst({ where: eq(posts.id, after) });
    if (row) cursor = { createdAt: row.createdAt, id: row.id };
  }

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
  const data = idRows.map((r) => userMap.get(r.id)).filter((u): u is PublicUser => !!u);
  return c.json<Page<PublicUser>>({ data, nextCursor });
});

searchRoutes.get('/tags', async (c) => {
  const { q, limit } = query(c, searchQuerySchema);
  const term = likeContains(q.replace(/^#/, ''));
  const rows = await db
    .select({ name: tags.name })
    .from(tags)
    .where(ilike(tags.name, term))
    .orderBy(desc(tags.createdAt))
    .limit(limit);
  return c.json({ data: rows.map((r) => r.name), nextCursor: null });
});
