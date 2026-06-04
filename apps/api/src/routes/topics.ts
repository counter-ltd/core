// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Topics: named communities a user can join, each with its own post feed.
 *
 * A topic is addressed by a URL-friendly slug rather than its id. Every read
 * route is public, but membership-changing routes (create, join, leave) need
 * auth. When a viewer is signed in we also tell them whether they're a member,
 * so the UI can show join versus leave.
 */
import { Hono } from 'hono';
import {
  db,
  topics,
  topicMembers,
  posts,
  eq,
  and,
  desc,
  count,
  inArray,
} from '@counter/db';
import { createTopicSchema, paginationQuerySchema } from '@counter/types';
import type { Page, Post, Topic } from '@counter/types';
import { body, query } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { keysetWhere, paginate } from '../lib/cursor.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import { serializePostList } from '../services/serialize.ts';
import type { AppEnv } from '../types.ts';

export const topicRoutes = new Hono<AppEnv>();

/**
 * Build the full Topic response for a single topic: its fields plus live
 * member/post counts and, when a viewer is known, whether they belong.
 *
 * @param viewerId  The signed-in user, or undefined for an anonymous request.
 *                  When undefined the `viewer` block is omitted entirely (rather
 *                  than reported as not-a-member), so the client can tell "logged
 *                  out" apart from "logged in but not joined".
 */
async function serializeTopic(
  topicRow: { id: string; slug: string; name: string; description: string | null; createdAt: Date },
  viewerId?: string,
): Promise<Topic> {
  // Counts and the viewer's membership are independent lookups, so run them
  // together. This serializes one topic at a time, fine for the single-topic
  // routes; the list route below batches instead to avoid N of these.
  const [memberCount, postCount, viewerMembership] = await Promise.all([
    db
      .select({ value: count() })
      .from(topicMembers)
      .where(eq(topicMembers.topicId, topicRow.id))
      .then((r) => Number(r[0]?.value ?? 0)),
    db
      .select({ value: count() })
      .from(posts)
      .where(and(eq(posts.topicId, topicRow.id), eq(posts.deleted, false)))
      .then((r) => Number(r[0]?.value ?? 0)),
    viewerId
      ? db.query.topicMembers
          .findFirst({ where: and(eq(topicMembers.topicId, topicRow.id), eq(topicMembers.userId, viewerId)) })
          .then((r) => !!r)
      : Promise.resolve(false),
  ]);

  return {
    id: topicRow.id,
    slug: topicRow.slug,
    name: topicRow.name,
    description: topicRow.description,
    createdAt: topicRow.createdAt.toISOString(),
    counts: { members: memberCount, posts: postCount },
    // Only attach the viewer block when we actually have a viewer.
    ...(viewerId !== undefined ? { viewer: { isMember: viewerMembership } } : {}),
  };
}

// --- list all topics ---

// All topics, ordered by popularity (member count) then recency. Built to avoid
// the per-topic fan-out in serializeTopic: member counts come from the join,
// and post counts and the viewer's memberships are each fetched in one batched
// query keyed by the full id list.
topicRoutes.get('/', async (c) => {
  const viewerId = c.get('userId');

  const rows = await db
    .select({
      id: topics.id,
      slug: topics.slug,
      name: topics.name,
      description: topics.description,
      createdAt: topics.createdAt,
      memberCount: count(topicMembers.userId),
    })
    .from(topics)
    .leftJoin(topicMembers, eq(topicMembers.topicId, topics.id))
    .groupBy(topics.id)
    .orderBy(desc(count(topicMembers.userId)), desc(topics.createdAt));

  const topicIds = rows.map((r) => r.id);

  // Guard each batch on a non-empty id list: an empty inArray would build a
  // never-true clause and waste a round trip. The viewer membership query is
  // additionally skipped for logged-out callers.
  const [postCounts, membershipRows] = await Promise.all([
    topicIds.length
      ? db
          .select({ id: posts.topicId, value: count() })
          .from(posts)
          .where(and(inArray(posts.topicId, topicIds), eq(posts.deleted, false)))
          .groupBy(posts.topicId)
      : Promise.resolve([] as Array<{ id: string | null; value: number }>),
    viewerId && topicIds.length
      ? db
          .select({ topicId: topicMembers.topicId })
          .from(topicMembers)
          .where(and(eq(topicMembers.userId, viewerId), inArray(topicMembers.topicId, topicIds)))
      : Promise.resolve([] as Array<{ topicId: string }>),
  ]);

  // Fold the two batches into lookups so the final map stays O(1) per topic:
  // post counts by topic id, and the set of topics this viewer has joined.
  const postCountMap = new Map<string, number>();
  for (const r of postCounts) if (r.id) postCountMap.set(r.id, Number(r.value));
  const memberSet = new Set(membershipRows.map((r) => r.topicId));

  const data: Topic[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    createdAt: r.createdAt.toISOString(),
    counts: { members: Number(r.memberCount), posts: postCountMap.get(r.id) ?? 0 },
    ...(viewerId !== undefined ? { viewer: { isMember: memberSet.has(r.id) } } : {}),
  }));

  return c.json({ data, nextCursor: null });
});

// --- create topic ---

// Create a topic. We reject a duplicate slug up front with a clean validation
// error rather than leaning on the DB unique constraint, so the caller gets a
// 400 with a clear message instead of a generic 500.
topicRoutes.post('/', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, createTopicSchema);

  const existing = await db.query.topics.findFirst({ where: eq(topics.slug, input.slug) });
  if (existing) throw errors.validation('A topic with that slug already exists');

  const [created] = await db
    .insert(topics)
    .values({
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      createdBy: userId,
    })
    .returning();
  if (!created) throw errors.internal('Failed to create topic');

  // Creator auto-joins their own topic, so it shows up in their feed and the
  // member count starts at one. onConflictDoNothing keeps this idempotent.
  await db.insert(topicMembers).values({ topicId: created.id, userId }).onConflictDoNothing();

  return c.json(await serializeTopic(created, userId), 201);
});

// --- single topic (define before /:slug/posts etc.) ---

// One topic by slug. Slugs are stored lowercase, so normalise the param before
// looking it up to keep the URL case-insensitive.
topicRoutes.get('/:slug', async (c) => {
  const viewerId = c.get('userId');
  const slug = c.req.param('slug').toLowerCase();

  const topic = await db.query.topics.findFirst({ where: eq(topics.slug, slug) });
  if (!topic) throw errors.notFound('Topic not found');

  return c.json(await serializeTopic(topic, viewerId));
});

// --- topic posts feed ---

// The post feed for a topic, newest-first and keyset-paginated. Resolve the slug
// to a topic first so an unknown slug 404s before we run the feed query.
topicRoutes.get('/:slug/posts', async (c) => {
  const viewerId = c.get('userId');
  const slug = c.req.param('slug').toLowerCase();
  const { after, limit } = query(c, paginationQuerySchema);

  const topic = await db.query.topics.findFirst({ where: eq(topics.slug, slug) });
  if (!topic) throw errors.notFound('Topic not found');

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.posts.findFirst({ where: eq(posts.id, after) });
    if (row) cursor = { createdAt: row.createdAt, id: row.id };
  }

  const base = and(eq(posts.topicId, topic.id), eq(posts.deleted, false));
  const where = keysetWhere(posts.createdAt, posts.id, cursor, base);

  const rows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(where)
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit + 1);

  const { data: idRows, nextCursor } = paginate(rows, limit, (r) => r.id);
  const data = await serializePostList(idRows.map((r) => r.id), viewerId);
  return c.json<Page<Post>>({ data, nextCursor });
});

// --- join / leave ---

// Join a topic. onConflictDoNothing makes a repeat join a no-op, so the client
// can fire it without first checking membership and always gets isMember: true.
topicRoutes.post('/:slug/join', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const slug = c.req.param('slug').toLowerCase();

  const topic = await db.query.topics.findFirst({ where: eq(topics.slug, slug) });
  if (!topic) throw errors.notFound('Topic not found');

  await db
    .insert(topicMembers)
    .values({ topicId: topic.id, userId })
    .onConflictDoNothing();

  return c.json({ ok: true, isMember: true });
});

// Leave a topic. Deleting a membership that isn't there is harmless, so this is
// idempotent too and always reports isMember: false.
topicRoutes.delete('/:slug/join', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const slug = c.req.param('slug').toLowerCase();

  const topic = await db.query.topics.findFirst({ where: eq(topics.slug, slug) });
  if (!topic) throw errors.notFound('Topic not found');

  await db
    .delete(topicMembers)
    .where(and(eq(topicMembers.topicId, topic.id), eq(topicMembers.userId, userId)));

  return c.json({ ok: true, isMember: false });
});
