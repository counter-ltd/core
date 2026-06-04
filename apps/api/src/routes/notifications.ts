// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The signed-in user's notification inbox: listing them, and marking them read.
 *
 * Each notification points at an actor (who did the thing) and sometimes a post
 * (what they did it to). The list route hydrates those references through the
 * serializers so the client gets full user and post objects, not bare ids.
 */
import { Hono } from 'hono';
import { db, notifications, eq, and, desc } from '@counter/db';
import { paginationQuerySchema } from '@counter/types';
import type { Page, Notification } from '@counter/types';
import type { NotificationType } from '@counter/config';
import { query } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { keysetWhere, paginate } from '../lib/cursor.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import { serializeUsers, serializePosts } from '../services/serialize.ts';
import type { AppEnv } from '../types.ts';

export const notificationRoutes = new Hono<AppEnv>();

// A notification inbox is private by definition, so the whole router is behind
// auth. Each handler can then trust requireUserId without re-checking.
notificationRoutes.use('*', requireAuth);

// --- list ---

// Newest notifications first, keyset-paginated. We resolve the `after` cursor id
// into its (createdAt, id) pair because keyset paging needs the sort key, not
// just the id, to know where to resume.
notificationRoutes.get('/', async (c) => {
  const userId = requireUserId(c);
  const { after, limit } = query(c, paginationQuerySchema);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.notifications.findFirst({ where: eq(notifications.id, after) });
    if (row) cursor = { createdAt: row.createdAt, id: row.id };
  }

  // Always scope to this user's own rows; the cursor clause is layered on top.
  const base = eq(notifications.userId, userId);
  const where = keysetWhere(notifications.createdAt, notifications.id, cursor, base);
  // Fetch one extra row so paginate() can tell whether a next page exists
  // without a separate count query.
  const rows = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const { data: pageRows, nextCursor } = paginate(rows, limit, (r) => r.id);

  // Batch-hydrate every referenced actor and post in two queries instead of one
  // per notification. postId is nullable (a follow has no post), so drop the
  // nulls before asking for posts.
  const actorIds = pageRows.map((r) => r.actorId);
  const postIds = pageRows.map((r) => r.postId).filter((id): id is string => !!id);
  const [actors, posts] = await Promise.all([
    serializeUsers(actorIds, userId),
    serializePosts(postIds, userId),
  ]);

  const data: Notification[] = pageRows
    .map((r) => {
      // Skip the notification if its actor can't be resolved (deleted or
      // blocked account), rather than render a notification from nobody.
      const actor = actors.get(r.actorId);
      if (!actor) return null;
      return {
        id: r.id,
        type: r.type as NotificationType,
        actor,
        post: r.postId ? posts.get(r.postId) ?? null : null,
        read: r.read,
        createdAt: r.createdAt.toISOString(),
      } satisfies Notification;
    })
    .filter((n): n is Notification => !!n);

  return c.json<Page<Notification>>({ data, nextCursor });
});

// --- mark read ---

// "Mark all read" for the current user. The `read = false` filter keeps the
// write touching only the rows that actually need flipping.
notificationRoutes.post('/read', async (c) => {
  const userId = requireUserId(c);
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return c.json({ ok: true });
});

// Mark one notification read. We confirm it belongs to the caller before
// touching it, and answer a foreign or missing id with the same 404 so the
// endpoint never reveals that someone else's notification exists.
notificationRoutes.patch('/:id/read', async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const row = await db.query.notifications.findFirst({ where: eq(notifications.id, id) });
  if (!row || row.userId !== userId) throw errors.notFound('Notification not found');

  await db.update(notifications).set({ read: true }).where(eq(notifications.id, id));
  return c.json({ ok: true });
});
