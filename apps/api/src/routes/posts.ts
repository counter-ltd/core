import { Hono } from 'hono';
import {
  db,
  posts,
  media,
  likes,
  reposts,
  eq,
  and,
  desc,
  asc,
} from '@counter/db';
import {
  createPostSchema,
  createReplySchema,
  updatePostSchema,
  paginationQuerySchema,
} from '@counter/types';
import type { Page, Post, PublicUser, Thread } from '@counter/types';
import { VIEW_REFERRERS, type ViewReferrer } from '@counter/config';
import { body, query } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { keysetWhere, paginate } from '../lib/cursor.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import { serializePosts, serializePostList, serializeUsers } from '../services/serialize.ts';
import { followingFeed, rankedPublicFeed } from '../services/feed.ts';
import {
  syncPostTags,
  notifyMentions,
  createNotification,
  recordView,
} from '../services/content.ts';
import type { AppEnv } from '../types.ts';

export const postRoutes = new Hono<AppEnv>();

/** Load a post row or 404. By default rejects soft-deleted posts. */
async function getPostOr404(id: string, opts: { allowDeleted?: boolean } = {}) {
  const row = await db.query.posts.findFirst({ where: eq(posts.id, id) });
  if (!row || (row.deleted && !opts.allowDeleted)) throw errors.notFound('Post not found');
  return row;
}

async function serializeOne(id: string, viewerId?: string): Promise<Post> {
  const map = await serializePosts([id], viewerId);
  const post = map.get(id);
  if (!post) throw errors.notFound('Post not found');
  return post;
}

// --- feeds (define before /:id) ---

postRoutes.get('/public', async (c) => {
  const viewerId = c.get('userId');
  const { after, limit } = query(c, paginationQuerySchema);
  const { ids, nextCursor } = await rankedPublicFeed({ after, limit });
  const data = await serializePostList(ids, viewerId);
  return c.json<Page<Post>>({ data, nextCursor });
});

postRoutes.get('/', requireAuth, async (c) => {
  const viewerId = requireUserId(c);
  const { after, limit } = query(c, paginationQuerySchema);
  const { ids, nextCursor } = await followingFeed({ viewerId, after, limit });
  const data = await serializePostList(ids, viewerId);
  return c.json<Page<Post>>({ data, nextCursor });
});

// --- create ---

postRoutes.post('/', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, createPostSchema);

  if (input.repostOf) {
    // Quote/repost-as-post must reference an existing, non-deleted post.
    await getPostOr404(input.repostOf);
  }

  const [created] = await db
    .insert(posts)
    .values({ userId, body: input.body, repostOf: input.repostOf ?? null })
    .returning();
  if (!created) throw errors.internal('Failed to create post');

  if (input.media?.length) {
    await db.insert(media).values(
      input.media.map((m) => ({
        postId: created.id,
        userId,
        url: m.url,
        mimeType: m.mimeType,
        width: m.width ?? null,
        height: m.height ?? null,
        sizeBytes: m.sizeBytes ?? null,
        altText: m.altText ?? null,
      })),
    );
  }

  await syncPostTags(created.id, input.body);
  await notifyMentions(input.body, userId, created.id);

  if (input.repostOf) {
    const original = await db.query.posts.findFirst({ where: eq(posts.id, input.repostOf) });
    if (original) {
      await createNotification({
        userId: original.userId,
        type: 'repost',
        actorId: userId,
        postId: created.id,
      });
    }
  }

  return c.json(await serializeOne(created.id, userId), 201);
});

// --- single post ---

postRoutes.get('/:id', async (c) => {
  const viewerId = c.get('userId');
  const id = c.req.param('id');
  const post = await serializeOne(id, viewerId); // 404s if missing/deleted

  // Anonymous view tick. No identity recorded — ever.
  const refParam = c.req.query('ref');
  const referrer: ViewReferrer = VIEW_REFERRERS.includes(refParam as ViewReferrer)
    ? (refParam as ViewReferrer)
    : 'direct';
  await recordView(id, referrer);

  return c.json(post);
});

postRoutes.patch('/:id', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const input = await body(c, updatePostSchema);

  const row = await getPostOr404(id);
  if (row.userId !== userId) throw errors.forbidden('You can only edit your own posts');

  await db
    .update(posts)
    .set({ body: input.body, edited: true, updatedAt: new Date() })
    .where(eq(posts.id, id));
  await syncPostTags(id, input.body);

  return c.json(await serializeOne(id, userId));
});

postRoutes.delete('/:id', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const row = await getPostOr404(id);
  if (row.userId !== userId) throw errors.forbidden('You can only delete your own posts');

  // Soft delete: keeps thread structure intact, body is hidden by serializer.
  await db
    .update(posts)
    .set({ deleted: true, updatedAt: new Date() })
    .where(eq(posts.id, id));
  return c.json({ ok: true });
});

// --- likes ---

postRoutes.post('/:id/like', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const row = await getPostOr404(id);

  const inserted = await db
    .insert(likes)
    .values({ userId, postId: id })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) {
    await createNotification({ userId: row.userId, type: 'like', actorId: userId, postId: id });
  }
  return c.json({ ok: true, liked: true });
});

postRoutes.delete('/:id/like', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  await db.delete(likes).where(and(eq(likes.userId, userId), eq(likes.postId, id)));
  return c.json({ ok: true, liked: false });
});

postRoutes.get('/:id/likes', async (c) => {
  const viewerId = c.get('userId');
  const id = c.req.param('id');
  const { after, limit } = query(c, paginationQuerySchema);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db
      .select({ createdAt: likes.createdAt })
      .from(likes)
      .where(and(eq(likes.postId, id), eq(likes.userId, after)))
      .limit(1);
    if (row[0]) cursor = { createdAt: row[0].createdAt, id: after };
  }

  const base = eq(likes.postId, id);
  const where = keysetWhere(likes.createdAt, likes.userId, cursor, base);
  const rows = await db
    .select({ id: likes.userId })
    .from(likes)
    .where(where)
    .orderBy(desc(likes.createdAt), desc(likes.userId))
    .limit(limit + 1);

  const { data: idRows, nextCursor } = paginate(rows, limit, (r) => r.id);
  const userMap = await serializeUsers(
    idRows.map((r) => r.id),
    viewerId,
  );
  const data = idRows.map((r) => userMap.get(r.id)).filter((u): u is PublicUser => !!u);
  return c.json<Page<PublicUser>>({ data, nextCursor });
});

// --- reposts ---

postRoutes.post('/:id/repost', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const row = await getPostOr404(id);

  const inserted = await db
    .insert(reposts)
    .values({ userId, postId: id })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) {
    await createNotification({ userId: row.userId, type: 'repost', actorId: userId, postId: id });
  }
  return c.json({ ok: true, reposted: true });
});

postRoutes.delete('/:id/repost', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  await db.delete(reposts).where(and(eq(reposts.userId, userId), eq(reposts.postId, id)));
  return c.json({ ok: true, reposted: false });
});

// --- thread ---

postRoutes.get('/:id/thread', async (c) => {
  const viewerId = c.get('userId');
  const id = c.req.param('id');
  const row = await getPostOr404(id, { allowDeleted: true });

  // Walk up the parent chain for ancestor context (bounded).
  const ancestorIds: string[] = [];
  let parentId = row.parentId;
  for (let i = 0; i < 50 && parentId; i++) {
    const parent = await db.query.posts.findFirst({ where: eq(posts.id, parentId) });
    if (!parent) break;
    ancestorIds.unshift(parent.id);
    parentId = parent.parentId;
  }

  // Direct replies, oldest first, bounded.
  const replyRows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.parentId, id), eq(posts.deleted, false)))
    .orderBy(asc(posts.createdAt), asc(posts.id))
    .limit(100);

  const all = await serializePosts(
    [...ancestorIds, id, ...replyRows.map((r) => r.id)],
    viewerId,
  );

  const post = all.get(id);
  if (!post) throw errors.notFound('Post not found');

  const thread: Thread = {
    ancestors: ancestorIds.map((aid) => all.get(aid)).filter((p): p is Post => !!p),
    post,
    replies: replyRows.map((r) => all.get(r.id)).filter((p): p is Post => !!p),
  };
  return c.json(thread);
});

// --- replies ---

postRoutes.post('/:id/replies', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const parent = await getPostOr404(id);
  const input = await body(c, createReplySchema);

  const [created] = await db
    .insert(posts)
    .values({ userId, body: input.body, parentId: id })
    .returning();
  if (!created) throw errors.internal('Failed to create reply');

  if (input.media?.length) {
    await db.insert(media).values(
      input.media.map((m) => ({
        postId: created.id,
        userId,
        url: m.url,
        mimeType: m.mimeType,
        width: m.width ?? null,
        height: m.height ?? null,
        sizeBytes: m.sizeBytes ?? null,
        altText: m.altText ?? null,
      })),
    );
  }

  await syncPostTags(created.id, input.body);
  await notifyMentions(input.body, userId, created.id);
  await createNotification({ userId: parent.userId, type: 'reply', actorId: userId, postId: created.id });

  return c.json(await serializeOne(created.id, userId), 201);
});

postRoutes.get('/:id/replies', async (c) => {
  const viewerId = c.get('userId');
  const id = c.req.param('id');
  const { after, limit } = query(c, paginationQuerySchema);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.posts.findFirst({ where: eq(posts.id, after) });
    if (row) cursor = { createdAt: row.createdAt, id: row.id };
  }

  const base = and(eq(posts.parentId, id), eq(posts.deleted, false));
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
