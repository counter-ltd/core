// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The admin control panel API: the dashboard, user moderation, group and
 * permission management, content moderation, the report queue, and the audit
 * trail.
 *
 * Every route here is gated by `requirePermission(...)`, which resolves the
 * caller's effective permissions (the union across their groups) and 403s when
 * the needed capability is missing. Anything that changes state writes an
 * `admin_audit_log` row through `recordAudit`, so the panel can always answer
 * "who did what". Reads are public to no one; there are no anonymous admin
 * endpoints.
 */
import { Hono } from 'hono';
import {
  db,
  users,
  posts,
  follows,
  groups,
  userGroups,
  adminAuditLog,
  reports,
  eq,
  and,
  or,
  desc,
  ilike,
  count,
  inArray,
  gte,
  sql,
} from '@counter/db';
import {
  createGroupSchema,
  updateGroupSchema,
  assignGroupSchema,
  banUserSchema,
  suspendUserSchema,
  adminUserQuerySchema,
  reportQuerySchema,
  resolveReportSchema,
  auditQuerySchema,
  adminPasswordResetSchema,
} from '@counter/types';
import type {
  AdminGroup,
  AdminUserListItem,
  AdminUserDetail,
  AdminReport,
  AuditEntry,
  DashboardStats,
  GroupSummary,
  Page,
} from '@counter/types';
import {
  PERMISSION_KEYS,
  PERMISSION_META,
  type Permission,
  type UserStatus,
  type ReportReason,
  type ReportTargetType,
  type ReportStatus,
} from '@counter/config';
import { loadServerEnv } from '@counter/config/env';
import { body, query } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { keysetWhere, paginate } from '../lib/cursor.ts';
import { requireUserId } from '../middleware/auth.ts';
import { requirePermission } from '../middleware/admin.ts';
import { recordAudit } from '../services/permissions.ts';
import { revokeAllSessions } from '../lib/auth.ts';
import { issuePasswordReset } from '../lib/passwordreset.ts';
import { decryptField } from '../lib/crypto.ts';
import { sendPasswordResetEmail } from '../lib/email.ts';
import type { AppEnv } from '../types.ts';

export const adminRoutes = new Hono<AppEnv>();

// --- helpers ---

/**
 * Attach each user's group badges in one batched query rather than per row.
 *
 * @param userIds  The page of user ids to decorate.
 * @returns        A map from user id to its group summaries (empty array if none).
 */
async function groupsByUser(userIds: string[]): Promise<Map<string, GroupSummary[]>> {
  const map = new Map<string, GroupSummary[]>();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({
      userId: userGroups.userId,
      id: groups.id,
      slug: groups.slug,
      name: groups.name,
      color: groups.color,
    })
    .from(userGroups)
    .innerJoin(groups, eq(groups.id, userGroups.groupId))
    .where(inArray(userGroups.userId, userIds))
    .orderBy(groups.name);
  for (const r of rows) {
    const list = map.get(r.userId) ?? [];
    list.push({ id: r.id, slug: r.slug, name: r.name, color: r.color });
    map.set(r.userId, list);
  }
  return map;
}

/** Resolve a pagination cursor id into the (createdAt, id) pair keysetWhere needs. */
async function userCursor(after: string | undefined) {
  if (!after) return null;
  const row = await db.query.users.findFirst({ where: eq(users.id, after) });
  return row ? { createdAt: row.createdAt, id: row.id } : null;
}

// --- dashboard ---

// Site-wide counts for the control-panel landing page. Each figure is its own
// aggregate; they run together so the dashboard is a single round of queries.
adminRoutes.get('/dashboard', requirePermission('dashboard.view'), async (c) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [
    totalUsers,
    suspendedUsers,
    bannedUsers,
    newUsers,
    totalPosts,
    removedPosts,
    openReports,
    totalGroups,
  ] = await Promise.all([
    db.select({ v: count() }).from(users).then((r) => Number(r[0]?.v ?? 0)),
    db.select({ v: count() }).from(users).where(eq(users.status, 'suspended')).then((r) => Number(r[0]?.v ?? 0)),
    db.select({ v: count() }).from(users).where(eq(users.status, 'banned')).then((r) => Number(r[0]?.v ?? 0)),
    db.select({ v: count() }).from(users).where(gte(users.createdAt, sevenDaysAgo)).then((r) => Number(r[0]?.v ?? 0)),
    db.select({ v: count() }).from(posts).then((r) => Number(r[0]?.v ?? 0)),
    db.select({ v: count() }).from(posts).where(eq(posts.removedByAdmin, true)).then((r) => Number(r[0]?.v ?? 0)),
    db.select({ v: count() }).from(reports).where(eq(reports.status, 'open')).then((r) => Number(r[0]?.v ?? 0)),
    db.select({ v: count() }).from(groups).then((r) => Number(r[0]?.v ?? 0)),
  ]);

  const stats: DashboardStats = {
    users: {
      total: totalUsers,
      // 'active' is everyone who isn't otherwise flagged, so derive it rather
      // than running a fourth status query.
      active: totalUsers - suspendedUsers - bannedUsers,
      suspended: suspendedUsers,
      banned: bannedUsers,
      newLast7d: newUsers,
    },
    posts: { total: totalPosts, removed: removedPosts },
    reports: { open: openReports },
    groups: { total: totalGroups },
  };
  return c.json(stats);
});

// --- permission catalogue ---

// The full list of capabilities with display metadata, so the group editor can
// render a labelled checklist. Static and identical for every caller; gated on
// groups.view since only the group editor needs it.
adminRoutes.get('/permissions', requirePermission('groups.view'), (c) => {
  const data = PERMISSION_KEYS.map((key) => ({ key, ...PERMISSION_META[key] }));
  return c.json({ data });
});

// --- users ---

// Paginated, searchable user list. `q` matches username or display name; the
// optional status filter narrows to a single moderation state. Keyset paginated
// on (createdAt, id) like every other list.
adminRoutes.get('/users', requirePermission('users.view'), async (c) => {
  const { q, status, after, limit } = query(c, adminUserQuerySchema);

  const filters = [];
  if (status) filters.push(eq(users.status, status));
  if (q) {
    const like = `%${q}%`;
    filters.push(or(ilike(users.username, like), ilike(users.displayName, like)));
  }
  const base = filters.length ? and(...filters) : undefined;
  const where = keysetWhere(users.createdAt, users.id, await userCursor(after), base);

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      status: users.status,
      suspendedUntil: users.suspendedUntil,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(limit + 1);

  const { data: pageRows, nextCursor } = paginate(rows, limit, (r) => r.id);
  const groupMap = await groupsByUser(pageRows.map((r) => r.id));

  const data: AdminUserListItem[] = pageRows.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    status: r.status as UserStatus,
    suspendedUntil: r.suspendedUntil ? r.suspendedUntil.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    groups: groupMap.get(r.id) ?? [],
  }));
  return c.json<Page<AdminUserListItem>>({ data, nextCursor });
});

// One user's full moderation detail, including their group memberships and a few
// content counts for context. Email is deliberately omitted: moderation never
// needs it, so the panel doesn't expose it.
adminRoutes.get('/users/:id', requirePermission('users.view'), async (c) => {
  const id = c.req.param('id');
  const row = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!row) throw errors.notFound('User not found');

  const [postCount, followerCount, followingCount, groupMap] = await Promise.all([
    db.select({ v: count() }).from(posts).where(and(eq(posts.userId, id), eq(posts.deleted, false))).then((r) => Number(r[0]?.v ?? 0)),
    db.select({ v: count() }).from(follows).where(eq(follows.followingId, id)).then((r) => Number(r[0]?.v ?? 0)),
    db.select({ v: count() }).from(follows).where(eq(follows.followerId, id)).then((r) => Number(r[0]?.v ?? 0)),
    groupsByUser([id]),
  ]);

  const detail: AdminUserDetail = {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    status: row.status as UserStatus,
    suspendedUntil: row.suspendedUntil ? row.suspendedUntil.toISOString() : null,
    statusReason: row.statusReason,
    verified: row.verified,
    createdAt: row.createdAt.toISOString(),
    groups: groupMap.get(id) ?? [],
    counts: { posts: postCount, followers: followerCount, following: followingCount },
  };
  return c.json(detail);
});

// Add a user to a group. Idempotent: a repeat assignment is a no-op rather than
// a conflict, so the client can fire it without checking membership first.
adminRoutes.post('/users/:id/groups', requirePermission('users.manage_groups'), async (c) => {
  const actorId = requireUserId(c);
  const id = c.req.param('id');
  const { groupId } = await body(c, assignGroupSchema);

  const [target, group] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, id) }),
    db.query.groups.findFirst({ where: eq(groups.id, groupId) }),
  ]);
  if (!target) throw errors.notFound('User not found');
  if (!group) throw errors.notFound('Group not found');

  await db
    .insert(userGroups)
    .values({ userId: id, groupId, assignedBy: actorId })
    .onConflictDoNothing();

  await recordAudit(actorId, {
    action: 'user.group_add',
    targetType: 'user',
    targetId: id,
    summary: `Added @${target.username} to group ${group.name}`,
    metadata: { groupId, groupSlug: group.slug },
  });

  const groupMap = await groupsByUser([id]);
  return c.json({ ok: true, groups: groupMap.get(id) ?? [] });
});

// Remove a user from a group. Idempotent for the same reason as the add.
adminRoutes.delete('/users/:id/groups/:groupId', requirePermission('users.manage_groups'), async (c) => {
  const actorId = requireUserId(c);
  const id = c.req.param('id');
  const groupId = c.req.param('groupId');

  const [target, group] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, id) }),
    db.query.groups.findFirst({ where: eq(groups.id, groupId) }),
  ]);
  if (!target) throw errors.notFound('User not found');

  await db
    .delete(userGroups)
    .where(and(eq(userGroups.userId, id), eq(userGroups.groupId, groupId)));

  await recordAudit(actorId, {
    action: 'user.group_remove',
    targetType: 'user',
    targetId: id,
    summary: `Removed @${target.username} from group ${group?.name ?? groupId}`,
    metadata: { groupId, groupSlug: group?.slug ?? null },
  });

  const groupMap = await groupsByUser([id]);
  return c.json({ ok: true, groups: groupMap.get(id) ?? [] });
});

// Ban a user: block sign-in indefinitely and cut their live sessions so the ban
// bites immediately rather than at access-token expiry. An admin can't ban
// themselves, which would be an easy way to lock the panel.
adminRoutes.post('/users/:id/ban', requirePermission('users.ban'), async (c) => {
  const actorId = requireUserId(c);
  const id = c.req.param('id');
  if (id === actorId) throw errors.validation('You cannot ban your own account');

  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target) throw errors.notFound('User not found');
  const { reason } = await body(c, banUserSchema);

  await db
    .update(users)
    .set({ status: 'banned', statusReason: reason ?? null, suspendedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, id));
  // Tear down refresh tokens so existing logins can't refresh; the short-lived
  // access token lapses on its own shortly after.
  await revokeAllSessions(id);

  await recordAudit(actorId, {
    action: 'user.ban',
    targetType: 'user',
    targetId: id,
    summary: `Banned @${target.username}`,
    metadata: { reason: reason ?? null },
  });
  return c.json({ ok: true, status: 'banned' });
});

// Lift a ban, returning the account to 'active'.
adminRoutes.post('/users/:id/unban', requirePermission('users.ban'), async (c) => {
  const actorId = requireUserId(c);
  const id = c.req.param('id');
  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target) throw errors.notFound('User not found');

  await db
    .update(users)
    .set({ status: 'active', statusReason: null, suspendedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, id));

  await recordAudit(actorId, {
    action: 'user.unban',
    targetType: 'user',
    targetId: id,
    summary: `Unbanned @${target.username}`,
  });
  return c.json({ ok: true, status: 'active' });
});

// Suspend a user until a chosen time. Like a ban, it revokes sessions; unlike a
// ban it carries an expiry, and a lapsed suspension auto-clears at the next
// login attempt (see enforceModerationStatus in auth.ts).
adminRoutes.post('/users/:id/suspend', requirePermission('users.suspend'), async (c) => {
  const actorId = requireUserId(c);
  const id = c.req.param('id');
  if (id === actorId) throw errors.validation('You cannot suspend your own account');

  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target) throw errors.notFound('User not found');
  const { until, reason } = await body(c, suspendUserSchema);

  const untilDate = new Date(until);
  if (untilDate.getTime() <= Date.now()) {
    throw errors.validation('Suspension end time must be in the future');
  }

  await db
    .update(users)
    .set({ status: 'suspended', statusReason: reason ?? null, suspendedUntil: untilDate, updatedAt: new Date() })
    .where(eq(users.id, id));
  await revokeAllSessions(id);

  await recordAudit(actorId, {
    action: 'user.suspend',
    targetType: 'user',
    targetId: id,
    summary: `Suspended @${target.username} until ${untilDate.toISOString()}`,
    metadata: { until: untilDate.toISOString(), reason: reason ?? null },
  });
  return c.json({ ok: true, status: 'suspended', suspendedUntil: untilDate.toISOString() });
});

// End a suspension early, returning the account to 'active'.
adminRoutes.post('/users/:id/unsuspend', requirePermission('users.suspend'), async (c) => {
  const actorId = requireUserId(c);
  const id = c.req.param('id');
  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target) throw errors.notFound('User not found');

  await db
    .update(users)
    .set({ status: 'active', statusReason: null, suspendedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, id));

  await recordAudit(actorId, {
    action: 'user.unsuspend',
    targetType: 'user',
    targetId: id,
    summary: `Lifted suspension on @${target.username}`,
  });
  return c.json({ ok: true, status: 'active' });
});

// Start a password reset on a user's behalf. Two deliveries: 'email' mails the
// user the link, 'link' returns the URL in the response so the admin can hand it
// over directly (for an account whose address is dead). Either way the token is
// the same one-time, one-hour credential the public flow uses, and issuing it
// voids any link the user already had. The link is never written to the audit
// log, only the fact that a reset happened and how it was delivered.
adminRoutes.post('/users/:id/password-reset', requirePermission('users.reset_password'), async (c) => {
  const actorId = requireUserId(c);
  const id = c.req.param('id');
  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target) throw errors.notFound('User not found');
  const { delivery } = await body(c, adminPasswordResetSchema);

  const token = await issuePasswordReset(id);
  const webUrl = c.env.PUBLIC_WEB_URL ?? 'https://counter.ltd';
  const link = `${webUrl}/reset-password?token=${token}`;

  if (delivery === 'email') {
    // No mail binding means email delivery can't work; say so plainly rather
    // than reporting a success that never sends. The admin can fall back to the
    // 'link' delivery, which needs no provider.
    if (!c.env.EMAIL) {
      throw errors.validation('Email delivery is not configured on this deployment. Generate a link instead.');
    }
    const env = loadServerEnv();
    // target.email is ciphertext; the mailer needs the real address.
    const email = await decryptField(target.email, env.MESSAGE_ENCRYPTION_KEY);
    const name = target.displayName || target.username;
    c.executionCtx.waitUntil(
      sendPasswordResetEmail(c.env.EMAIL, email, name, link).catch(() => {
        // Best effort: the admin can retry or switch to a link.
      }),
    );
  }

  await recordAudit(actorId, {
    action: 'user.password_reset',
    targetType: 'user',
    targetId: id,
    summary:
      delivery === 'email'
        ? `Emailed a password reset to @${target.username}`
        : `Generated a password reset link for @${target.username}`,
    metadata: { delivery },
  });

  // Echo the link back only when that's the chosen delivery; when we mailed it,
  // there's no reason to expose the live credential in the response too.
  return c.json({ ok: true, link: delivery === 'link' ? link : null });
});

// --- groups ---

/** Decorate group rows with their live member counts in one batched query. */
async function withMemberCounts(rows: Array<typeof groups.$inferSelect>): Promise<AdminGroup[]> {
  const ids = rows.map((g) => g.id);
  const counts = new Map<string, number>();
  if (ids.length) {
    const cRows = await db
      .select({ groupId: userGroups.groupId, v: count() })
      .from(userGroups)
      .where(inArray(userGroups.groupId, ids))
      .groupBy(userGroups.groupId);
    for (const r of cRows) counts.set(r.groupId, Number(r.v));
  }
  return rows.map((g) => ({
    id: g.id,
    slug: g.slug,
    name: g.name,
    description: g.description,
    // Stored as a jsonb string array; narrow to the live Permission union.
    permissions: (g.permissions as string[]).filter((p): p is Permission =>
      (PERMISSION_KEYS as readonly string[]).includes(p),
    ),
    color: g.color,
    isSystem: g.isSystem,
    memberCount: counts.get(g.id) ?? 0,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  }));
}

// Every group, system groups first, then by name. Carries member counts so the
// list can show how many people each one covers.
adminRoutes.get('/groups', requirePermission('groups.view'), async (c) => {
  const rows = await db.select().from(groups).orderBy(desc(groups.isSystem), groups.name);
  return c.json({ data: await withMemberCounts(rows) });
});

// One group by id.
adminRoutes.get('/groups/:id', requirePermission('groups.view'), async (c) => {
  const id = c.req.param('id');
  const row = await db.query.groups.findFirst({ where: eq(groups.id, id) });
  if (!row) throw errors.notFound('Group not found');
  const [out] = await withMemberCounts([row]);
  return c.json(out);
});

// Create a group. A duplicate slug is rejected up front with a clean validation
// error rather than leaning on the unique constraint to surface as a 500.
adminRoutes.post('/groups', requirePermission('groups.manage'), async (c) => {
  const actorId = requireUserId(c);
  const input = await body(c, createGroupSchema);

  const existing = await db.query.groups.findFirst({ where: eq(groups.slug, input.slug) });
  if (existing) throw errors.conflict('A group with that slug already exists');

  const [created] = await db
    .insert(groups)
    .values({
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? null,
      permissions: input.permissions,
      isSystem: false,
    })
    .returning();
  if (!created) throw errors.internal('Failed to create group');

  await recordAudit(actorId, {
    action: 'group.create',
    targetType: 'group',
    targetId: created.id,
    summary: `Created group ${created.name}`,
    metadata: { slug: created.slug, permissions: input.permissions },
  });
  const [out] = await withMemberCounts([created]);
  return c.json(out, 201);
});

// Edit a group's metadata or permissions. System groups keep their slug (renaming
// the `admin` slug would break the all-permissions short-circuit), so a slug
// change on one is rejected; everything else about them is editable.
adminRoutes.patch('/groups/:id', requirePermission('groups.manage'), async (c) => {
  const actorId = requireUserId(c);
  const id = c.req.param('id');
  const input = await body(c, updateGroupSchema);

  const group = await db.query.groups.findFirst({ where: eq(groups.id, id) });
  if (!group) throw errors.notFound('Group not found');

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if ('name' in input) patch.name = input.name;
  if ('description' in input) patch.description = input.description;
  if ('color' in input) patch.color = input.color;
  if ('permissions' in input) patch.permissions = input.permissions;
  if ('slug' in input && input.slug !== undefined && input.slug !== group.slug) {
    if (group.isSystem) throw errors.validation('A system group cannot be renamed by slug');
    const clash = await db.query.groups.findFirst({ where: eq(groups.slug, input.slug) });
    if (clash) throw errors.conflict('A group with that slug already exists');
    patch.slug = input.slug;
  }

  await db.update(groups).set(patch).where(eq(groups.id, id));

  await recordAudit(actorId, {
    action: 'group.update',
    targetType: 'group',
    targetId: id,
    summary: `Updated group ${group.name}`,
    metadata: { changed: Object.keys(patch).filter((k) => k !== 'updatedAt') },
  });
  const updated = await db.query.groups.findFirst({ where: eq(groups.id, id) });
  const [out] = await withMemberCounts([updated!]);
  return c.json(out);
});

// Delete a group. System groups are protected so a site can't strip its own
// admin role; memberships cascade away with the row.
adminRoutes.delete('/groups/:id', requirePermission('groups.manage'), async (c) => {
  const actorId = requireUserId(c);
  const id = c.req.param('id');
  const group = await db.query.groups.findFirst({ where: eq(groups.id, id) });
  if (!group) throw errors.notFound('Group not found');
  if (group.isSystem) throw errors.validation('System groups cannot be deleted');

  await db.delete(groups).where(eq(groups.id, id));

  await recordAudit(actorId, {
    action: 'group.delete',
    targetType: 'group',
    targetId: id,
    summary: `Deleted group ${group.name}`,
    metadata: { slug: group.slug },
  });
  return c.json({ ok: true });
});

// --- content moderation ---

// One post in full for review, including removed ones (the normal post route
// hides those). Returns the author handle so the moderator has context.
adminRoutes.get('/posts/:id', requirePermission('posts.moderate'), async (c) => {
  const id = c.req.param('id');
  const row = await db
    .select({
      id: posts.id,
      body: posts.body,
      deleted: posts.deleted,
      removedByAdmin: posts.removedByAdmin,
      createdAt: posts.createdAt,
      authorId: users.id,
      authorUsername: users.username,
      authorDisplayName: users.displayName,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.userId))
    .where(eq(posts.id, id))
    .then((r) => r[0]);
  if (!row) throw errors.notFound('Post not found');
  return c.json({
    id: row.id,
    body: row.body,
    deleted: row.deleted,
    removedByAdmin: row.removedByAdmin,
    createdAt: row.createdAt.toISOString(),
    author: { id: row.authorId, username: row.authorUsername, displayName: row.authorDisplayName },
  });
});

// Remove a post as a moderator. Soft-delete plus the removedByAdmin flag, so the
// author can't quietly un-remove it and the queue can show it was a moderation
// action rather than a self-delete.
adminRoutes.delete('/posts/:id', requirePermission('posts.moderate'), async (c) => {
  const actorId = requireUserId(c);
  const id = c.req.param('id');
  const post = await db.query.posts.findFirst({ where: eq(posts.id, id) });
  if (!post) throw errors.notFound('Post not found');

  await db
    .update(posts)
    .set({ deleted: true, removedByAdmin: true, updatedAt: new Date() })
    .where(eq(posts.id, id));

  await recordAudit(actorId, {
    action: 'post.remove',
    targetType: 'post',
    targetId: id,
    summary: `Removed post ${id}`,
    metadata: { authorId: post.userId },
  });
  return c.json({ ok: true });
});

// Restore a moderator-removed post.
adminRoutes.post('/posts/:id/restore', requirePermission('posts.moderate'), async (c) => {
  const actorId = requireUserId(c);
  const id = c.req.param('id');
  const post = await db.query.posts.findFirst({ where: eq(posts.id, id) });
  if (!post) throw errors.notFound('Post not found');

  await db
    .update(posts)
    .set({ deleted: false, removedByAdmin: false, updatedAt: new Date() })
    .where(eq(posts.id, id));

  await recordAudit(actorId, {
    action: 'post.restore',
    targetType: 'post',
    targetId: id,
    summary: `Restored post ${id}`,
  });
  return c.json({ ok: true });
});

// Nuke a post: a hard delete of the post and its entire descendant tree, with no
// restore. Unlike `posts.moderate` (a reversible soft-delete), this is a separate,
// more dangerous capability, so it's gated on its own `posts.nuke` permission.
//
// The catch the soft-delete path doesn't have: `parent_id` and `repost_of` are
// SET NULL on delete, so deleting just the root would orphan its replies and
// reposts rather than remove them. We walk the closure of both edges first, then
// delete the whole set in one statement. The cascading FKs (media, likes, the
// reposts/likes join tables, post_tags, post_views) clear themselves; the two
// SET NULL referrers (notifications, reports) are deleted explicitly so nothing
// is left pointing at a post the moderator meant to erase.
adminRoutes.delete('/posts/:id/nuke', requirePermission('posts.nuke'), async (c) => {
  const actorId = requireUserId(c);
  const id = c.req.param('id');
  const post = await db.query.posts.findFirst({ where: eq(posts.id, id) });
  if (!post) throw errors.notFound('Post not found');

  // One data-modifying statement, so it's atomic without an explicit transaction:
  // the recursive CTE gathers the closure once, the two side deletes run against
  // that same set, and the final DELETE returns the rows it erased for the count.
  const deleted = await db.execute(sql`
    WITH RECURSIVE descendants AS (
      SELECT ${posts.id} FROM ${posts} WHERE ${posts.id} = ${id}
      UNION
      SELECT p.id FROM ${posts} p
      JOIN descendants d ON p.parent_id = d.id OR p.repost_of = d.id
    ),
    del_notifications AS (
      DELETE FROM notifications WHERE post_id IN (SELECT id FROM descendants)
    ),
    del_reports AS (
      DELETE FROM reports WHERE target_type = 'post' AND target_id IN (SELECT id FROM descendants)
    )
    DELETE FROM ${posts} WHERE ${posts.id} IN (SELECT id FROM descendants)
    RETURNING ${posts.id}
  `);

  const count = deleted.length;
  await recordAudit(actorId, {
    action: 'post.nuke',
    targetType: 'post',
    targetId: id,
    summary: `Nuked post ${id} and ${count - 1} reply/repost descendant(s)`,
    metadata: { authorId: post.userId, totalDeleted: count },
  });
  return c.json({ ok: true, deleted: count });
});

// --- reports ---

/** Resolve a batch of user ids into the slim refs reports and audit entries use. */
async function userRefs(ids: string[]) {
  const map = new Map<string, { id: string; username: string; displayName: string | null }>();
  const real = [...new Set(ids.filter(Boolean))];
  if (real.length === 0) return map;
  const rows = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, real));
  for (const r of rows) map.set(r.id, r);
  return map;
}

// The moderation queue. Defaults to open reports; a status filter shows resolved
// or dismissed history. Newest-first, keyset paginated.
adminRoutes.get('/reports', requirePermission('reports.view'), async (c) => {
  const { status, after, limit } = query(c, reportQuerySchema);

  const base = status ? eq(reports.status, status) : eq(reports.status, 'open');
  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.reports.findFirst({ where: eq(reports.id, after) });
    if (row) cursor = { createdAt: row.createdAt, id: row.id };
  }
  const where = keysetWhere(reports.createdAt, reports.id, cursor, base);

  const rows = await db
    .select()
    .from(reports)
    .where(where)
    .orderBy(desc(reports.createdAt), desc(reports.id))
    .limit(limit + 1);

  const { data: pageRows, nextCursor } = paginate(rows, limit, (r) => r.id);
  const refMap = await userRefs(pageRows.flatMap((r) => [r.reporterId, r.resolvedBy].filter((x): x is string => !!x)));

  const data: AdminReport[] = pageRows.map((r) => ({
    id: r.id,
    targetType: r.targetType as ReportTargetType,
    targetId: r.targetId,
    reason: r.reason as ReportReason,
    detail: r.detail,
    status: r.status as ReportStatus,
    reporter: r.reporterId ? refMap.get(r.reporterId) ?? null : null,
    resolvedBy: r.resolvedBy ? refMap.get(r.resolvedBy) ?? null : null,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
  return c.json<Page<AdminReport>>({ data, nextCursor });
});

// Close a report as resolved or dismissed. Records who closed it and when so the
// history is attributable.
adminRoutes.post('/reports/:id/resolve', requirePermission('reports.resolve'), async (c) => {
  const actorId = requireUserId(c);
  const id = c.req.param('id');
  const { status } = await body(c, resolveReportSchema);

  const report = await db.query.reports.findFirst({ where: eq(reports.id, id) });
  if (!report) throw errors.notFound('Report not found');

  await db
    .update(reports)
    .set({ status, resolvedBy: actorId, resolvedAt: new Date() })
    .where(eq(reports.id, id));

  await recordAudit(actorId, {
    action: `report.${status}`,
    targetType: 'report',
    targetId: id,
    summary: `Marked report ${id} ${status}`,
    metadata: { targetType: report.targetType, targetId: report.targetId },
  });
  return c.json({ ok: true, status });
});

// --- audit log ---

// The immutable trail of admin actions, newest-first. Each entry carries the
// actor's handle (or null if their account is gone) for a readable log.
adminRoutes.get('/audit', requirePermission('audit.view'), async (c) => {
  const { after, limit } = query(c, auditQuerySchema);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.adminAuditLog.findFirst({ where: eq(adminAuditLog.id, after) });
    if (row) cursor = { createdAt: row.createdAt, id: row.id };
  }
  const where = keysetWhere(adminAuditLog.createdAt, adminAuditLog.id, cursor, undefined);

  const rows = await db
    .select()
    .from(adminAuditLog)
    .where(where)
    .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
    .limit(limit + 1);

  const { data: pageRows, nextCursor } = paginate(rows, limit, (r) => r.id);
  const refMap = await userRefs(pageRows.map((r) => r.actorId).filter((x): x is string => !!x));

  const data: AuditEntry[] = pageRows.map((r) => ({
    id: r.id,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    summary: r.summary,
    metadata: r.metadata,
    actor: r.actorId ? refMap.get(r.actorId) ?? null : null,
    createdAt: r.createdAt.toISOString(),
  }));
  return c.json<Page<AuditEntry>>({ data, nextCursor });
});
