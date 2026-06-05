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
import { db, notifications, notificationPreferences, eq, and, inArray, desc } from '@counter/db';
import { paginationQuerySchema, notificationPreferencesSchema } from '@counter/types';
import type { Page, Notification, NotificationPreferences } from '@counter/types';
import { NOTIFICATION_TYPES } from '@counter/config';
import type { NotificationType } from '@counter/config';
import { body, query } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { keysetWhere, paginate } from '../lib/cursor.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import {
  serializeUsers,
  serializePosts,
  serializeConversationRefs,
} from '../services/serialize.ts';
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

  // Batch-hydrate every referenced actor, post, and conversation in parallel
  // instead of one query per notification. postId and conversationId are both
  // nullable (a follow has no post, only a message has a conversation), so drop
  // the nulls before asking for each.
  const actorIds = pageRows.map((r) => r.actorId);
  const postIds = pageRows.map((r) => r.postId).filter((id): id is string => !!id);
  const convIds = pageRows.map((r) => r.conversationId).filter((id): id is string => !!id);
  const [actors, posts, convs] = await Promise.all([
    serializeUsers(actorIds, userId),
    serializePosts(postIds, userId),
    serializeConversationRefs(convIds, userId),
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
        conversation: r.conversationId ? convs.get(r.conversationId) ?? null : null,
        read: r.read,
        createdAt: r.createdAt.toISOString(),
      } satisfies Notification;
    })
    .filter((n): n is Notification => !!n);

  return c.json<Page<Notification>>({ data, nextCursor });
});

// --- preferences ---

// The caller's per-type toggles. We store only the muted types (a row per mute),
// so reading them means starting from all-on and flipping off whatever has a
// row. That way a brand-new account with no rows gets every type enabled.
notificationRoutes.get('/preferences', async (c) => {
  const userId = requireUserId(c);
  const muted = await db
    .select({ type: notificationPreferences.type })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  const mutedSet = new Set(muted.map((r) => r.type));

  const prefs = Object.fromEntries(
    NOTIFICATION_TYPES.map((t) => [t, !mutedSet.has(t)]),
  ) as NotificationPreferences;
  return c.json(prefs);
});

// Update toggles. The body carries only the types that changed, each a boolean.
// true (on) deletes any mute row; false (off) inserts one. We translate the
// client's on/off into our mute-row model here so the storage stays default-on.
notificationRoutes.put('/preferences', async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, notificationPreferencesSchema);

  const toMute: string[] = [];
  const toUnmute: string[] = [];
  for (const type of NOTIFICATION_TYPES) {
    const value = input[type];
    if (value === undefined) continue; // untouched toggle keeps its current state
    if (value) toUnmute.push(type);
    else toMute.push(type);
  }

  if (toMute.length > 0) {
    // onConflictDoNothing so re-muting an already-muted type is a harmless no-op
    // rather than a primary-key violation.
    await db
      .insert(notificationPreferences)
      .values(toMute.map((type) => ({ userId, type })))
      .onConflictDoNothing();
  }
  if (toUnmute.length > 0) {
    await db
      .delete(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          inArray(notificationPreferences.type, toUnmute),
        ),
      );
  }

  return c.json({ ok: true });
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
