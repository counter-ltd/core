// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Everything you can do to a post: the two feeds, create/read/edit/delete,
 * likes, reposts, replies, and the threaded view around a single post.
 *
 * Reads are open to anonymous viewers under `optionalAuth` (the viewer id only
 * tunes viewer-relative flags like `liked`); writes sit behind `requireAuth`.
 * Deletes are soft so reply threads don't lose their spine, and post views are
 * recorded with no identity attached. The shared `getPostOr404` / `serializeOne`
 * helpers cover the loading and 404 logic the handlers all repeat.
 */
import { Hono } from 'hono';
import {
  db,
  posts,
  media,
  likes,
  reposts,
  topics,
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

/**
 * Load a raw post row or throw 404.
 *
 * Soft-deleted posts read as "not found" by default. Pass `allowDeleted` for
 * the one caller (the thread view) that still needs a deleted post's row to
 * keep the reply structure intact.
 */
async function getPostOr404(id: string, opts: { allowDeleted?: boolean } = {}) {
  const row = await db.query.posts.findFirst({ where: eq(posts.id, id) });
  if (!row || (row.deleted && !opts.allowDeleted)) throw errors.notFound('Post not found');
  return row;
}

/**
 * Serialize a single post into its API shape, 404ing if it can't be built.
 *
 * Goes through the batch `serializePosts` with a one-element list so the
 * viewer-relative fields are computed the exact same way as in the list
 * endpoints.
 */
async function serializeOne(id: string, viewerId?: string): Promise<Post> {
  const map = await serializePosts([id], viewerId);
  const post = map.get(id);
  if (!post) throw errors.notFound('Post not found');
  return post;
}

// --- feeds (define before /:id) ---
//
// These literal paths have to be registered before the `/:id` routes below.
// Otherwise Hono would match `/public` as an id and the feed would 404.

// The ranked public timeline. Open to everyone; the viewer id only personalizes
// per-post flags, not which posts appear.
postRoutes.get('/public', async (c) => {
  const viewerId = c.get('userId');
  const { after, limit } = query(c, paginationQuerySchema);
  const { ids, nextCursor } = await rankedPublicFeed({ after, limit });
  const data = await serializePostList(ids, viewerId);
  return c.json<Page<Post>>({ data, nextCursor });
});

// The home feed: posts from people you follow. Requires auth because there's no
// such thing as a following feed without a viewer.
postRoutes.get('/', requireAuth, async (c) => {
  const viewerId = requireUserId(c);
  const { after, limit } = query(c, paginationQuerySchema);
  const { ids, nextCursor } = await followingFeed({ viewerId, after, limit });
  const data = await serializePostList(ids, viewerId);
  return c.json<Page<Post>>({ data, nextCursor });
});

// --- create ---

// Create a top-level post (or a quote-repost, when `repostOf` is set). We
// validate the referenced post and topic exist before inserting so we never
// leave a post pointing at something that isn't there.
postRoutes.post('/', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, createPostSchema);

  if (input.repostOf) {
    await getPostOr404(input.repostOf);
  }

  if (input.topicId) {
    const topic = await db.query.topics.findFirst({ where: eq(topics.id, input.topicId) });
    if (!topic) throw errors.notFound('Topic not found');
  }

  const [created] = await db
    .insert(posts)
    .values({ userId, body: input.body, repostOf: input.repostOf ?? null, topicId: input.topicId ?? null })
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

  // Parse hashtags into the tag tables and notify anyone @-mentioned in the
  // body. Both derive from the post body, so they run after the row exists.
  await syncPostTags(created.id, input.body);
  await notifyMentions(input.body, userId, created.id);

  // A quote-repost notifies the original author. Re-fetch rather than trust the
  // earlier getPostOr404 result, since notifications need the author id.
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

// Fetch one post and count the view. The view tick is deliberately anonymous:
// recordView stores a referrer bucket and nothing that identifies the viewer.
postRoutes.get('/:id', async (c) => {
  const viewerId = c.get('userId');
  const id = c.req.param('id');
  const post = await serializeOne(id, viewerId); // 404s if missing/deleted

  // Coerce the `ref` query param to a known referrer, defaulting unrecognized
  // values to 'direct' so a junk referrer can't pollute the view stats.
  const refParam = c.req.query('ref');
  const referrer: ViewReferrer = VIEW_REFERRERS.includes(refParam as ViewReferrer)
    ? (refParam as ViewReferrer)
    : 'direct';
  await recordView(id, referrer);

  return c.json(post);
});

// Edit a post's body. Owner-only, and we re-sync tags afterward since the new
// body may have added or removed hashtags. The `edited` flag is what the UI uses
// to show the "edited" marker.
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

// Delete a post. Owner-only and a soft delete: we flag the row rather than
// remove it so any replies hanging off it keep their place in the thread. The
// serializer is what blanks the body out for deleted posts.
postRoutes.delete('/:id', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const row = await getPostOr404(id);
  if (row.userId !== userId) throw errors.forbidden('You can only delete your own posts');

  await db
    .update(posts)
    .set({ deleted: true, updatedAt: new Date() })
    .where(eq(posts.id, id));
  return c.json({ ok: true });
});

// --- likes ---

// Like a post. Idempotent via onConflictDoNothing, and the author is only
// notified on a genuinely new like so toggling doesn't re-notify.
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

// Unlike. Idempotent: removing a like that isn't there still reports the
// desired end state.
postRoutes.delete('/:id/like', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  await db.delete(likes).where(and(eq(likes.userId, userId), eq(likes.postId, id)));
  return c.json({ ok: true, liked: false });
});

// The users who liked a post, newest like first, keyset-paginated. The `after`
// cursor is a user id; we look up that user's like row to recover its sort
// position within this post's likes.
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
  // Re-walk idRows to preserve cursor order, dropping any id that didn't
  // serialize (e.g. a since-deleted account).
  const data = idRows.map((r) => userMap.get(r.id)).filter((u): u is PublicUser => !!u);
  return c.json<Page<PublicUser>>({ data, nextCursor });
});

// --- reposts ---

// Plain repost (no quote body). Same idempotent insert + notify-once pattern as
// likes. The quote-repost path lives in the create handler via `repostOf`.
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

// Undo a repost. Idempotent like unlike.
postRoutes.delete('/:id/repost', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  await db.delete(reposts).where(and(eq(reposts.userId, userId), eq(reposts.postId, id)));
  return c.json({ ok: true, reposted: false });
});

// --- thread ---

// The conversation around a post: its ancestor chain, the post itself, and its
// direct replies. Loads the post with allowDeleted so a deleted-but-replied-to
// post can still anchor the thread (the serializer blanks its body).
postRoutes.get('/:id/thread', async (c) => {
  const viewerId = c.get('userId');
  const id = c.req.param('id');
  const row = await getPostOr404(id, { allowDeleted: true });

  // Walk up the parent chain to build the ancestor context, oldest-first
  // (unshift) so the thread reads top to bottom. Capped at 50 hops so a
  // pathological chain can't fan out into 50+ sequential queries.
  const ancestorIds: string[] = [];
  let parentId = row.parentId;
  for (let i = 0; i < 50 && parentId; i++) {
    const parent = await db.query.posts.findFirst({ where: eq(posts.id, parentId) });
    if (!parent) break;
    ancestorIds.unshift(parent.id);
    parentId = parent.parentId;
  }

  // Direct replies only (not the whole subtree), oldest first, capped at 100.
  const replyRows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.parentId, id), eq(posts.deleted, false)))
    .orderBy(asc(posts.createdAt), asc(posts.id))
    .limit(100);

  // Serialize ancestors, the post, and replies in one batch to avoid N+1, then
  // pick each group back out of the returned map.
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

// Post a reply to an existing post. Mirrors the create handler (media, tags,
// mentions) but sets `parentId` to link it into the thread and always notifies
// the parent's author.
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

// Paginated replies to a post, newest first. This is the standalone, paged view
// of replies; the thread endpoint above returns only the first batch inline.
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
