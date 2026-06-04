import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  db,
  users,
  posts,
  follows,
  eq,
  and,
  desc,
  inArray,
} from '@counter/db';
import { updateProfileSchema, paginationQuerySchema } from '@counter/types';
import type { Page, PublicUser, Post } from '@counter/types';
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
import type { AppEnv } from '../types.ts';

export const userRoutes = new Hono<AppEnv>();

// --- own profile ---

userRoutes.get('/me', requireAuth, async (c) => {
  const userId = requireUserId(c);
  return c.json(await getPrivateUser(userId));
});

userRoutes.patch('/me', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, updateProfileSchema);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if ('displayName' in input) patch.displayName = input.displayName;
  if ('bio' in input) patch.bio = input.bio;
  if ('avatarUrl' in input) patch.avatarUrl = input.avatarUrl;

  await db.update(users).set(patch).where(eq(users.id, userId));
  return c.json(await getPrivateUser(userId));
});

// --- public profile ---

userRoutes.get('/:username', async (c) => {
  const viewerId = c.get('userId');
  return c.json(await getPublicUser(c.req.param('username'), viewerId));
});

userRoutes.get('/:username/posts', async (c) => {
  const viewerId = c.get('userId');
  const { after, limit } = query(c, paginationQuerySchema);
  const target = await findUserByUsername(c.req.param('username'));
  if (!target) throw errors.notFound('User not found');

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.posts.findFirst({ where: eq(posts.id, after) });
    if (row) cursor = { createdAt: row.createdAt, id: row.id };
  }

  const base = and(eq(posts.userId, target.id), eq(posts.deleted, false));
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

async function followList(c: Context<AppEnv>, direction: 'followers' | 'following') {
  const viewerId = c.get('userId');
  const { after, limit } = query(c, paginationQuerySchema);
  const target = await findUserByUsername(c.req.param('username') as string);
  if (!target) throw errors.notFound('User not found');

  // followers: rows where following_id = target, list the follower.
  // following: rows where follower_id = target, list the followed.
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
  const data = idRows.map((r) => userMap.get(r.id)).filter((u): u is PublicUser => !!u);
  return c.json<Page<PublicUser>>({ data, nextCursor });
}

userRoutes.get('/:username/followers', (c) => followList(c, 'followers'));
userRoutes.get('/:username/following', (c) => followList(c, 'following'));

// --- follow / unfollow ---

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

userRoutes.delete('/:username/follow', requireAuth, async (c) => {
  const viewerId = requireUserId(c);
  const target = await findUserByUsername(c.req.param('username'));
  if (!target) throw errors.notFound('User not found');

  await db
    .delete(follows)
    .where(and(eq(follows.followerId, viewerId), eq(follows.followingId, target.id)));
  return c.json({ ok: true, following: false });
});
