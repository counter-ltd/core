// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The admin control panel's shared shapes: permission groups, user moderation,
 * reports, and the audit trail.
 *
 * The permission model is a fixed enum (PERMISSION_KEYS in @counter/config), so
 * the write schemas here validate against that list rather than accepting free
 * strings. A user's effective permissions are the union of every group they
 * belong to; the API computes that and hands it back on the private profile.
 */
import { z } from 'zod';
import {
  PERMISSION_KEYS,
  USER_STATUSES,
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  REPORT_STATUSES,
  GROUP,
} from '@counter/config';
import type { Permission, UserStatus, ReportReason, ReportTargetType, ReportStatus } from '@counter/config';

// --- groups ---

// A group slug is lowercase letters/digits/hyphen, mirroring usernames minus the
// underscore. Lowercased first so the stored form is canonical and unique.
const groupSlugSchema = z
  .string()
  .min(GROUP.MIN_SLUG_LENGTH)
  .max(GROUP.MAX_SLUG_LENGTH)
  .transform((s) => s.toLowerCase())
  .refine((s) => GROUP.SLUG_PATTERN.test(s), {
    message: 'Slug may contain only lowercase letters, digits and hyphens',
  });

// A permission must be one of the known keys. z.enum needs a non-empty tuple,
// which PERMISSION_KEYS already is (declared `as const`).
const permissionSchema = z.enum(PERMISSION_KEYS);

/** Body for `POST /admin/groups`. Permissions are validated against the fixed enum. */
export const createGroupSchema = z.object({
  slug: groupSlugSchema,
  name: z.string().min(1).max(GROUP.MAX_NAME_LENGTH),
  description: z.string().max(GROUP.MAX_DESCRIPTION_LENGTH).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  permissions: z.array(permissionSchema).default([]),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

/**
 * Body for `PATCH /admin/groups/:id`. Every field optional so a caller can edit
 * one thing. `slug` is omitted on purpose for system groups; the route rejects a
 * slug change there rather than the schema, so the message can explain why.
 */
export const updateGroupSchema = z
  .object({
    slug: groupSlugSchema,
    name: z.string().min(1).max(GROUP.MAX_NAME_LENGTH),
    description: z.string().max(GROUP.MAX_DESCRIPTION_LENGTH).nullable(),
    color: z.string().max(32).nullable(),
    permissions: z.array(permissionSchema),
  })
  .partial();
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

/** Body for `POST /admin/users/:id/groups`: which group to add the user to. */
export const assignGroupSchema = z.object({
  groupId: z.string().uuid(),
});
export type AssignGroupInput = z.infer<typeof assignGroupSchema>;

/** A group reduced to what a badge needs, attached to users in admin lists. */
export interface GroupSummary {
  id: string;
  slug: string;
  name: string;
  color: string | null;
}

/** A full group with its permission set and live member count. */
export interface AdminGroup {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  color: string | null;
  isSystem: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

// --- user moderation ---

/** Body for `POST /admin/users/:id/ban`. Reason is optional but recommended. */
export const banUserSchema = z.object({
  reason: z.string().max(500).nullable().optional(),
});
export type BanUserInput = z.infer<typeof banUserSchema>;

/**
 * Body for `POST /admin/users/:id/suspend`: an expiry and an optional reason.
 * `until` is an ISO timestamp the route requires to be in the future.
 */
export const suspendUserSchema = z.object({
  until: z.string().datetime(),
  reason: z.string().max(500).nullable().optional(),
});
export type SuspendUserInput = z.infer<typeof suspendUserSchema>;

/** Filters for `GET /admin/users`: a text search, a status filter, and a cursor. */
export const adminUserQuerySchema = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(USER_STATUSES).optional(),
  after: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminUserQuery = z.infer<typeof adminUserQuerySchema>;

/** A user as a row in the admin user list. */
export interface AdminUserListItem {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  suspendedUntil: string | null;
  createdAt: string;
  groups: GroupSummary[];
}

/** A user's full admin detail: the list shape plus moderation context and counts. */
export interface AdminUserDetail extends AdminUserListItem {
  statusReason: string | null;
  verified: boolean;
  counts: {
    posts: number;
    followers: number;
    following: number;
  };
}

// --- reports ---

/** Body for `POST /reports`: what's being reported and why. Filed by any signed-in user. */
export const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  detail: z.string().max(1000).nullable().optional(),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;

/** Body for `POST /admin/reports/:id/resolve`: close the report one way or the other. */
export const resolveReportSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
});
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;

/** Filters for `GET /admin/reports`: a status filter (defaults to open) and a cursor. */
export const reportQuerySchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  after: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/** A user reduced to what the admin panel shows for an actor or reporter. */
export interface AdminUserRef {
  id: string;
  username: string;
  displayName: string | null;
}

/** A report as it appears in the moderation queue. Named `AdminReport` to avoid
 *  colliding with the `Report` row type exported from @counter/db. */
export interface AdminReport {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  reporter: AdminUserRef | null;
  resolvedBy: AdminUserRef | null;
  resolvedAt: string | null;
  createdAt: string;
}

// --- audit log ---

/** Pagination for `GET /admin/audit`. Newest entries first. */
export const auditQuerySchema = z.object({
  after: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** One entry in the admin audit trail. */
export interface AuditEntry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
  metadata: unknown;
  actor: AdminUserRef | null;
  createdAt: string;
}

// --- dashboard ---

/** The numbers the control-panel landing page renders. */
export interface DashboardStats {
  users: {
    total: number;
    active: number;
    suspended: number;
    banned: number;
    /** Accounts created in the last seven days. */
    newLast7d: number;
  };
  posts: {
    total: number;
    removed: number;
  };
  reports: {
    open: number;
  };
  groups: {
    total: number;
  };
}
