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

notificationRoutes.use('*', requireAuth);

notificationRoutes.get('/', async (c) => {
  const userId = requireUserId(c);
  const { after, limit } = query(c, paginationQuerySchema);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.notifications.findFirst({ where: eq(notifications.id, after) });
    if (row) cursor = { createdAt: row.createdAt, id: row.id };
  }

  const base = eq(notifications.userId, userId);
  const where = keysetWhere(notifications.createdAt, notifications.id, cursor, base);
  const rows = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const { data: pageRows, nextCursor } = paginate(rows, limit, (r) => r.id);

  const actorIds = pageRows.map((r) => r.actorId);
  const postIds = pageRows.map((r) => r.postId).filter((id): id is string => !!id);
  const [actors, posts] = await Promise.all([
    serializeUsers(actorIds, userId),
    serializePosts(postIds, userId),
  ]);

  const data: Notification[] = pageRows
    .map((r) => {
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

notificationRoutes.post('/read', async (c) => {
  const userId = requireUserId(c);
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return c.json({ ok: true });
});

notificationRoutes.patch('/:id/read', async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const row = await db.query.notifications.findFirst({ where: eq(notifications.id, id) });
  if (!row || row.userId !== userId) throw errors.notFound('Notification not found');

  await db.update(notifications).set({ read: true }).where(eq(notifications.id, id));
  return c.json({ ok: true });
});
