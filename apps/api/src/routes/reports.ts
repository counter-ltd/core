// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Filing a report. The other half of moderation lives in routes/admin.ts (the
 * queue and its resolution); this is the single endpoint any signed-in user
 * calls to flag a post or another account.
 *
 * A report points at a post or a user by id. We confirm the target exists before
 * storing the row, and we collapse a repeat report from the same person on the
 * same target into the existing open one, so a user spamming the button doesn't
 * flood the moderators' queue with duplicates.
 */
import { Hono } from 'hono';
import { db, reports, posts, users, eq, and } from '@counter/db';
import { createReportSchema } from '@counter/types';
import { body } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import type { AppEnv } from '../types.ts';

export const reportRoutes = new Hono<AppEnv>();

// File a report against a post or a user. Auth-only: an anonymous flag would be
// unactionable and trivially abusable, so reporting requires an account.
reportRoutes.post('/', requireAuth, async (c) => {
  const reporterId = requireUserId(c);
  const input = await body(c, createReportSchema);

  // Confirm the target is real so the queue never points at nothing. The check
  // also stops a typo'd id from creating an un-investigable report.
  if (input.targetType === 'post') {
    const post = await db.query.posts.findFirst({ where: eq(posts.id, input.targetId) });
    if (!post) throw errors.notFound('Post not found');
  } else {
    const user = await db.query.users.findFirst({ where: eq(users.id, input.targetId) });
    if (!user) throw errors.notFound('User not found');
    // Reporting yourself is almost certainly a misclick; reject it cleanly.
    if (user.id === reporterId) throw errors.validation('You cannot report yourself');
  }

  // Collapse duplicates: if this reporter already has an open report on this
  // exact target, return it rather than stacking another row.
  const existing = await db.query.reports.findFirst({
    where: and(
      eq(reports.reporterId, reporterId),
      eq(reports.targetType, input.targetType),
      eq(reports.targetId, input.targetId),
      eq(reports.status, 'open'),
    ),
  });
  if (existing) return c.json({ ok: true, id: existing.id, duplicate: true });

  const [created] = await db
    .insert(reports)
    .values({
      reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      detail: input.detail ?? null,
    })
    .returning({ id: reports.id });
  if (!created) throw errors.internal('Failed to file report');

  return c.json({ ok: true, id: created.id }, 201);
});
