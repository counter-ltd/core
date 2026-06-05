// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * User-facing endpoints: your own profile, other people's public profiles,
 * their posts, their follower/following lists, and the follow/unfollow actions.
 *
 * A viewer's identity is optional on the read endpoints (it only affects
 * viewer-relative fields like `isFollowing`), so those run under `optionalAuth`
 * and read `c.get('userId')` directly. The mutating routes sit behind
 * `requireAuth`. Listing endpoints all use the shared keyset cursor helpers for
 * stable pagination.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  db,
  users,
  posts,
  follows,
  deviceKeys,
  eq,
  and,
  desc,
  inArray,
  isNull,
} from '@counter/db';
import { updateProfileSchema, paginationQuerySchema, presenceSettingsSchema } from '@counter/types';
import type { Page, PublicUser, Post, PresenceSettings } from '@counter/types';
import type { PresenceVisibility, MessagingPrivacy } from '@counter/config';
import { body, query } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { keysetWhere, paginate } from '../lib/cursor.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import {
  getPrivateUser,
  getPublicUser,
  findUserByUsername,
} from '../services/userquery.ts';
import { serializeUsers, serializePostList } from '../services/serialize.ts';
import { createNotification } from '../services/content.ts';
import { setUserAvatar } from '../services/media.ts';
import type { AppEnv } from '../types.ts';

export const userRoutes = new Hono<AppEnv>();

// --- own profile ---

// The caller's own profile, including private fields like email that the public
// view withholds.
userRoutes.get('/me', requireAuth, async (c) => {
  const userId = requireUserId(c);
  return c.json(await getPrivateUser(userId));
});

// Partial profile update. We build the patch with `'x' in input` rather than
// truthiness checks so a caller can deliberately clear a field (send `null` for
// bio) without us mistaking that for "field omitted, leave it alone".
userRoutes.patch('/me', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, updateProfileSchema);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if ('displayName' in input) patch.displayName = input.displayName;
  if ('bio' in input) patch.bio = input.bio;

  await db.update(users).set(patch).where(eq(users.id, userId));
  // The avatar lives behind a refcounted media object, so it can't be a plain
  // column write: setUserAvatar swaps the object, fixes both refcounts, and
  // derives the served avatarUrl.
  if ('avatarObjectId' in input) await setUserAvatar(userId, input.avatarObjectId ?? null);
  return c.json(await getPrivateUser(userId));
});

// --- presence settings ---

// Read the caller's own presence configuration.
userRoutes.get('/me/presence', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!row) throw errors.notFound('User not found');
  return c.json<PresenceSettings>({
    onlineStatusEnabled: row.onlineStatusEnabled,
    onlineStatusVisibility: row.onlineStatusVisibility as PresenceVisibility,
    lastSeenEnabled: row.lastSeenEnabled,
    lastSeenVisibility: row.lastSeenVisibility as PresenceVisibility,
    heartbeatIntervalSeconds: row.heartbeatIntervalSeconds,
    messagingPrivacy: row.messagingPrivacy as MessagingPrivacy,
    typingIndicatorsEnabled: row.typingIndicatorsEnabled,
  });
});

// Partial presence update. Same `'x' in input` pattern as PATCH /me so
// a caller can change one field without accidentally resetting the others.
userRoutes.put('/me/presence', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, presenceSettingsSchema);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if ('onlineStatusEnabled' in input) patch.onlineStatusEnabled = input.onlineStatusEnabled;
  if ('onlineStatusVisibility' in input) patch.onlineStatusVisibility = input.onlineStatusVisibility;
  if ('lastSeenEnabled' in input) patch.lastSeenEnabled = input.lastSeenEnabled;
  if ('lastSeenVisibility' in input) patch.lastSeenVisibility = input.lastSeenVisibility;
  if ('heartbeatIntervalSeconds' in input) patch.heartbeatIntervalSeconds = input.heartbeatIntervalSeconds;
  if ('messagingPrivacy' in input) patch.messagingPrivacy = input.messagingPrivacy;
  if ('typingIndicatorsEnabled' in input) patch.typingIndicatorsEnabled = input.typingIndicatorsEnabled;

  await db.update(users).set(patch).where(eq(users.id, userId));
  return c.json({ ok: true });
});

// Lightweight ping that records "the user is active right now". Called
// periodically by clients while the user is online. Always updates lastSeenAt
// regardless of enabled flags because the flags only control display, not
// collection, and the user may re-enable a feature mid-session.
userRoutes.post('/me/heartbeat', requireAuth, async (c) => {
  const userId = requireUserId(c);
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
  return c.json({ ok: true });
});

// --- public profile ---

// Anyone's public profile by username. The optional viewer id lets the response
// carry viewer-relative flags (e.g. whether you follow this person).
userRoutes.get('/:username', async (c) => {
  const viewerId = c.get('userId');
  return c.json(await getPublicUser(c.req.param('username'), viewerId));
});

// All registered device keys for a user. Senders fetch this to build the
// encryption target list: one v2 copy per device key, wrapped in v3 format.
// Returns an empty array (not 404) when the user exists but has no keys yet,
// so callers can distinguish "not found" from "not set up for E2EE".
userRoutes.get('/:username/public-key', async (c) => {
  const row = await findUserByUsername(c.req.param('username'));
  if (!row) throw errors.notFound('User not found');
  const keys = await db
    .select({ deviceId: deviceKeys.deviceId, publicKey: deviceKeys.publicKey })
    .from(deviceKeys)
    .where(eq(deviceKeys.userId, row.id));
  return c.json({ keys });
});

// A user's own posts, newest first, keyset-paginated. The `after` cursor is a
// post id; we look that post up to recover its (createdAt, id) sort position,
// and silently ignore an unknown id rather than erroring on a stale cursor.
// `filter=posts` (the default) excludes replies; `filter=all` includes them.
userRoutes.get('/:username/posts', async (c) => {
  const viewerId = c.get('userId');
  const { after, limit } = query(c, paginationQuerySchema);
  const filterParam = c.req.query('filter');
  const postsOnly = filterParam !== 'all';
  const target = await findUserByUsername(c.req.param('username'));
  if (!target) throw errors.notFound('User not found');

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.posts.findFirst({ where: eq(posts.id, after) });
    if (row) cursor = { createdAt: row.createdAt, id: row.id };
  }

  const base = and(
    eq(posts.userId, target.id),
    eq(posts.deleted, false),
    // Replies have a parentId; exclude them when the caller only wants root posts.
    postsOnly ? isNull(posts.parentId) : undefined,
  );
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

// --- follower / following lists ---

/**
 * Page through one side of the follow graph for a user. Both the
 * `/followers` and `/following` endpoints are this same query with the two
 * `follows` columns swapped, so we factor it out and pick the columns by
 * `direction`.
 *
 * The `follows` table has one row per edge: `followerId -> followingId`. For
 * followers we anchor on `followingId = target` and list each `followerId`; for
 * following we anchor on `followerId = target` and list each `followingId`. The
 * cursor anchors on the listed user's id within that anchored set.
 */
async function followList(c: Context<AppEnv>, direction: 'followers' | 'following') {
  const viewerId = c.get('userId');
  const { after, limit } = query(c, paginationQuerySchema);
  const target = await findUserByUsername(c.req.param('username') as string);
  if (!target) throw errors.notFound('User not found');

  const anchorCol = direction === 'followers' ? follows.followingId : follows.followerId;
  const otherCol = direction === 'followers' ? follows.followerId : follows.followingId;

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db
      .select({ createdAt: follows.createdAt })
      .from(follows)
      .where(and(eq(anchorCol, target.id), eq(otherCol, after)))
      .limit(1);
    if (row[0]) cursor = { createdAt: row[0].createdAt, id: after };
  }

  const base = eq(anchorCol, target.id);
  const where = keysetWhere(follows.createdAt, otherCol, cursor, base);

  const rows = await db
    .select({ id: otherCol })
    .from(follows)
    .where(where)
    .orderBy(desc(follows.createdAt), desc(otherCol))
    .limit(limit + 1);

  const { data: idRows, nextCursor } = paginate(rows, limit, (r) => r.id);
  const userMap = await serializeUsers(
    idRows.map((r) => r.id),
    viewerId,
  );
  // serializeUsers returns a map, so re-walk idRows to keep the cursor order and
  // drop any id that didn't serialize (e.g. a since-deleted user).
  const data = idRows.map((r) => userMap.get(r.id)).filter((u): u is PublicUser => !!u);
  return c.json<Page<PublicUser>>({ data, nextCursor });
}

userRoutes.get('/:username/followers', (c) => followList(c, 'followers'));
userRoutes.get('/:username/following', (c) => followList(c, 'following'));

// --- follow / unfollow ---

// Follow a user. `onConflictDoNothing` makes a repeat follow a no-op, and we
// only fire the notification when a row was actually inserted, so re-following
// someone you already follow doesn't spam them. Self-follows are rejected up
// front.
userRoutes.post('/:username/follow', requireAuth, async (c) => {
  const viewerId = requireUserId(c);
  const target = await findUserByUsername(c.req.param('username'));
  if (!target) throw errors.notFound('User not found');
  if (target.id === viewerId) throw errors.validation('You cannot follow yourself');

  const inserted = await db
    .insert(follows)
    .values({ followerId: viewerId, followingId: target.id })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    await createNotification({ userId: target.id, type: 'follow', actorId: viewerId });
  }
  return c.json({ ok: true, following: true });
});

// Unfollow. Idempotent: deleting a non-existent edge is fine and still reports
// `following: false`, which is the state the caller wanted.
userRoutes.delete('/:username/follow', requireAuth, async (c) => {
  const viewerId = requireUserId(c);
  const target = await findUserByUsername(c.req.param('username'));
  if (!target) throw errors.notFound('User not found');

  await db
    .delete(follows)
    .where(and(eq(follows.followerId, viewerId), eq(follows.followingId, target.id)));
  return c.json({ ok: true, following: false });
});
