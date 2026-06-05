// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Resolving what a user is allowed to do, and recording what admins actually did.
 *
 * The permission model is a fixed enum: a group carries a subset of
 * PERMISSION_KEYS, and a user's effective set is the union across every group
 * they're in. The one special case is the `admin` system group, which always
 * resolves to the full set so a newly-added capability can never accidentally
 * lock existing admins out of it.
 */
import { db, userGroups, groups, adminAuditLog, eq } from '@counter/db';
import { PERMISSION_KEYS, SYSTEM_GROUPS } from '@counter/config';
import type { Permission } from '@counter/config';
import type { GroupSummary } from '@counter/types';

/**
 * The groups a user belongs to, joined to their full rows, ordered by name.
 *
 * Returns the raw group rows (slug, permissions, colour, and so on) so callers
 * can build either a badge summary or the effective-permission union without a
 * second query.
 */
export async function getUserGroupRows(userId: string) {
  return db
    .select({
      id: groups.id,
      slug: groups.slug,
      name: groups.name,
      color: groups.color,
      permissions: groups.permissions,
    })
    .from(userGroups)
    .innerJoin(groups, eq(groups.id, userGroups.groupId))
    .where(eq(userGroups.userId, userId))
    .orderBy(groups.name);
}

/** Reduce group rows to the badge summaries the API hands clients. */
export function toGroupSummaries(
  rows: Array<{ id: string; slug: string; name: string; color: string | null }>,
): GroupSummary[] {
  return rows.map((g) => ({ id: g.id, slug: g.slug, name: g.name, color: g.color }));
}

/**
 * Fold a user's group rows into their effective permission set.
 *
 * Membership in the `admin` system group short-circuits to every permission;
 * otherwise it's the de-duplicated union of each group's stored keys. Unknown
 * strings (a key removed from the code after it was stored) are dropped so the
 * result only ever contains live `Permission` values.
 */
export function effectivePermissions(
  rows: Array<{ slug: string; permissions: string[] }>,
): Permission[] {
  if (rows.some((g) => g.slug === SYSTEM_GROUPS.ADMIN)) {
    return [...PERMISSION_KEYS];
  }
  const valid = new Set<string>(PERMISSION_KEYS);
  const set = new Set<Permission>();
  for (const g of rows) {
    for (const p of g.permissions) {
      if (valid.has(p)) set.add(p as Permission);
    }
  }
  return [...set];
}

/** Convenience: a user's effective permissions in one call, for middleware. */
export async function getUserPermissions(userId: string): Promise<Permission[]> {
  const rows = await getUserGroupRows(userId);
  return effectivePermissions(rows);
}

/** Fields a caller supplies when writing an audit entry. The actor is passed separately. */
export interface AuditInput {
  action: string;
  targetType?: 'user' | 'post' | 'group' | 'report';
  targetId?: string;
  summary: string;
  metadata?: unknown;
}

/**
 * Append one entry to the admin audit trail.
 *
 * Best-effort by design: the privileged action it records has already happened
 * and committed by the time this runs, so a logging failure must not roll it
 * back or 500 the response. Any error is swallowed after a console warning.
 */
export async function recordAudit(actorId: string, input: AuditInput): Promise<void> {
  try {
    await db.insert(adminAuditLog).values({
      actorId,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      summary: input.summary,
      metadata: input.metadata ?? null,
    });
  } catch (err) {
    console.warn('Failed to write audit log entry', input.action, err);
  }
}
