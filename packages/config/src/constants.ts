// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Shared, client-safe constants for the whole Counter stack: validation limits,
 * rate-limit budgets, the public ranking algorithm, and the enums the API and
 * web both check against.
 *
 * Anything in here can end up in the browser bundle, so keep it to plain values
 * with no Node imports (see index.ts for why that boundary matters).
 */

/** Page-size defaults for any list endpoint. MAX_LIMIT caps what a client can ask for. */
export const PAGINATION = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

/** Token-bucket budget shared by the rate limiter: LIMIT requests per WINDOW_SECONDS. */
export const RATE_LIMIT = {
  /** Requests allowed per window, per client. */
  LIMIT: 300,
  /** Window length in seconds. */
  WINDOW_SECONDS: 60,
} as const;

/** Post authoring limits. Bodies past MAX_BODY_LENGTH are rejected at validation. */
export const POST = {
  MAX_BODY_LENGTH: 5000,
} as const;

/**
 * Media upload + storage limits, enforced server-side at POST /media.
 *
 * `ALLOWED_MIME_TYPES` is the allowlist the byte sniffer checks against; the
 * client-supplied Content-Type is never trusted. `GC_GRACE_HOURS` is how long
 * an unreferenced object survives before the sweep reclaims it, which doubles
 * as the window a client has between uploading and attaching.
 */
export const MEDIA = {
  /** Hard ceiling on a single upload. Workers can stream larger, but images don't need it. */
  MAX_UPLOAD_BYTES: 8 * 1024 * 1024,
  /** Reject images whose width or height exceeds this, before they reach R2. */
  MAX_DIMENSION: 4096,
  /** Formats we accept, by sniffed MIME. Anything else is rejected as bad media. */
  ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const,
  /** Grace window before a refCount-0 object is eligible for the GC sweep. */
  GC_GRACE_HOURS: 24,
} as const;

/** Direct message limits. */
export const MESSAGE = {
  MAX_BODY_LENGTH: 10_000,
  // A v2 E2EE body embeds an SPKI-base64 ephemeral public key (~124 chars) plus
  // IV plus ciphertext, which is larger than the raw plaintext. 20k is a safe
  // ceiling for a 10k-character message after encryption.
  MAX_ENCRYPTED_BODY_LENGTH: 20_000,
} as const;

/** Account field limits and the handle rules, enforced on signup and profile edits. */
export const USER = {
  MIN_USERNAME_LENGTH: 2,
  MAX_USERNAME_LENGTH: 30,
  /** Lowercase letters, digits, underscore. Case-insensitive handle. */
  USERNAME_PATTERN: /^[a-z0-9_]+$/,
  MAX_DISPLAY_NAME_LENGTH: 60,
  MAX_BIO_LENGTH: 300,
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 200,
} as const;

/** Where a post view came from. Anonymous, never tied to a person. */
export const VIEW_REFERRERS = ['feed', 'profile', 'search', 'direct', 'external'] as const;
export type ViewReferrer = (typeof VIEW_REFERRERS)[number];

/**
 * The kinds of notification we generate. Mirrors the free-text `type` column on
 * notifications, and doubles as the set of toggles a user sees in notification
 * settings: every type here is something they can mute.
 */
export const NOTIFICATION_TYPES = [
  'like',
  'repost',
  'reply',
  'follow',
  'mention',
  'message',
  // Tunnel Talk invite: time-sensitive, so users can mute it independently from
  // regular message notifications if they don't want to be interrupted.
  'tunnel_invite',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** The device platforms we can deliver push to. Only native iOS today. */
export const DEVICE_PLATFORMS = ['ios'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/**
 * The ranking algorithm, public by design. Counter exposes this verbatim through
 * GET /algorithm, so editing these weights is editing the feed in the open.
 *
 * The score for a post is its recency decay plus its public engagement, each
 * term scaled by the weights below. Tuning here changes what surfaces and how
 * fast it sinks; there is no per-user model, the same numbers apply to everyone.
 */
export const ALGORITHM = {
  version: '1.0.0',
  description:
    'Chronological-leaning ranking with light engagement and recency signals. No personalization profile, no individual tracking. Score = base recency decay + weighted public engagement.',
  weights: {
    // recency is the anchor at 1.0; every other weight is read relative to it.
    recency: 1.0,
    // Engagement multipliers. Reposts count for more than likes because they
    // carry the post into another timeline; replies sit in between.
    likes: 0.5,
    reposts: 0.8,
    replies: 0.6,
    /**
     * Half-life of the recency decay, in hours. After this many hours a post's
     * recency term has halved, so a smaller number makes the feed churn faster.
     */
    recencyHalfLifeHours: 6,
  },
  parameters: {
    /** Posts older than this (hours) are excluded from the ranked feed. 168h = 7 days. */
    maxAgeHours: 168,
    /** Reposts and replies are folded into the parent for ranking. */
    foldReplies: true,
  },
} as const;

/**
 * Who is allowed to send a direct message to a given user.
 *
 * 'everyone' allows anyone to start a conversation directly. 'followers'
 * restricts direct messages to accounts that follow the recipient; anyone
 * else must send a message request instead. 'nobody' blocks all incoming
 * messages and requests entirely.
 */
export const MESSAGING = {
  PRIVACY_OPTIONS: ['everyone', 'followers', 'nobody'] as const,
  DEFAULT_PRIVACY: 'everyone' as const,
} as const;
export type MessagingPrivacy = (typeof MESSAGING.PRIVACY_OPTIONS)[number];

/**
 * Online status and last-seen visibility and heartbeat constraints.
 *
 * Both features are off by default. Visibility controls who can see each one
 * independently. The heartbeat interval is user-configurable within the bounds
 * below; the server adds a 30-second grace window on top when deciding "online".
 */
/**
 * Tunnel Talk session constraints.
 *
 * Invites expire quickly on purpose: a stale invite banner is worse than no
 * banner, and the recipient is by definition online when invited.
 */
export const TUNNEL = {
  /** Seconds before a pending invite auto-expires and is marked declined. */
  INVITE_EXPIRES_SECONDS: 60,
} as const;

export const PRESENCE = {
  VISIBILITY_OPTIONS: ['everyone', 'followers', 'mutualFollowers'] as const,
  DEFAULT_VISIBILITY: 'everyone' as const,
  DEFAULT_HEARTBEAT_INTERVAL: 300,
  MIN_HEARTBEAT_INTERVAL: 60,
  MAX_HEARTBEAT_INTERVAL: 3600,
  /** Added on top of the user's interval when computing "still online". */
  ONLINE_GRACE_SECONDS: 30,
} as const;
export type PresenceVisibility = (typeof PRESENCE.VISIBILITY_OPTIONS)[number];

/** Stable machine-readable error codes. The API sends these in the `code` field
 *  so clients can branch on them instead of parsing human-facing messages. */
export const ERROR_CODES = {
  VALIDATION: 'validation_error',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rate_limited',
  INTERNAL: 'internal_error',
} as const;

// --- admin / RBAC ---

/**
 * Every capability the admin system understands, as a flat list of stable keys.
 *
 * The model is deliberately a fixed enum, not rows in a table: a permission is a
 * thing code checks for, so it has to exist in code anyway. Groups hold a subset
 * of these keys (stored as a jsonb array), and a user's effective set is the
 * union across all the groups they're in. Adding a capability means adding a key
 * here and a `requirePermission(...)` somewhere that enforces it.
 *
 * Naming is `domain.action`. Keep the list sorted by domain so the group editor
 * can group rows by the prefix without extra metadata.
 */
export const PERMISSION_KEYS = [
  // The control panel itself: the overview/stats landing page.
  'dashboard.view',
  // People management.
  'users.view',
  'users.manage_groups',
  'users.ban',
  'users.suspend',
  // Groups and the permissions they carry.
  'groups.view',
  'groups.manage',
  // Content moderation.
  'posts.moderate',
  'posts.nuke',
  'reports.view',
  'reports.resolve',
  // The audit trail of admin actions.
  'audit.view',
] as const;
export type Permission = (typeof PERMISSION_KEYS)[number];

/**
 * Display metadata for each permission, so the group editor can render a labelled,
 * grouped checklist without hard-coding copy in the UI. `category` is the section
 * heading; `label` and `description` explain the capability to whoever's editing a
 * group. Kept here (client-safe) so web and iOS show identical wording.
 */
export const PERMISSION_META: Record<
  Permission,
  { category: string; label: string; description: string }
> = {
  'dashboard.view': {
    category: 'Dashboard',
    label: 'View dashboard',
    description: 'See the admin overview and site-wide stats.',
  },
  'users.view': {
    category: 'Users',
    label: 'View users',
    description: 'Browse and search the user list and open account details.',
  },
  'users.manage_groups': {
    category: 'Users',
    label: 'Assign groups',
    description: "Add or remove a user's group memberships.",
  },
  'users.ban': {
    category: 'Users',
    label: 'Ban users',
    description: 'Permanently block an account from signing in.',
  },
  'users.suspend': {
    category: 'Users',
    label: 'Suspend users',
    description: 'Temporarily block an account until a chosen time.',
  },
  'groups.view': {
    category: 'Groups',
    label: 'View groups',
    description: 'See the list of groups and the permissions each one holds.',
  },
  'groups.manage': {
    category: 'Groups',
    label: 'Manage groups',
    description: 'Create, edit, and delete groups and the permissions they carry.',
  },
  'posts.moderate': {
    category: 'Content',
    label: 'Moderate posts',
    description: 'Remove or restore any post, regardless of author.',
  },
  'posts.nuke': {
    category: 'Content',
    label: 'Nuke posts',
    description:
      'Permanently delete a post along with every reply and repost. Cannot be undone.',
  },
  'reports.view': {
    category: 'Content',
    label: 'View reports',
    description: 'See the queue of user-submitted reports.',
  },
  'reports.resolve': {
    category: 'Content',
    label: 'Resolve reports',
    description: 'Mark reports resolved or dismissed.',
  },
  'audit.view': {
    category: 'Audit',
    label: 'View audit log',
    description: 'Read the immutable log of every admin action.',
  },
};

/**
 * The groups the seed creates and that ship as `is_system` (renamable, but never
 * deletable, so a site can't lock itself out of administration). `admin` always
 * holds every permission; the resolver hands an admin the full set regardless of
 * what's stored, so a new capability can't accidentally exclude existing admins.
 */
export const SYSTEM_GROUPS = {
  ADMIN: 'admin',
  MODERATOR: 'moderator',
} as const;

/** Permissions a fresh `moderator` group carries. Content-focused, no group/ban power. */
export const MODERATOR_PERMISSIONS: Permission[] = [
  'dashboard.view',
  'users.view',
  'posts.moderate',
  'reports.view',
  'reports.resolve',
];

/** Account moderation states. 'active' is the default; the others block sign-in. */
export const USER_STATUSES = ['active', 'suspended', 'banned'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Why a user filed a report. Free-form detail rides alongside in a separate field. */
export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate',
  'violence',
  'illegal',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** What a report points at. Posts and users are the only reportable things today. */
export const REPORT_TARGET_TYPES = ['post', 'user'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

/** Lifecycle of a report in the moderation queue. */
export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Field limits for admin-authored group metadata. */
export const GROUP = {
  MIN_SLUG_LENGTH: 2,
  MAX_SLUG_LENGTH: 30,
  /** Lowercase letters, digits, hyphen. Mirrors the username rules minus underscore. */
  SLUG_PATTERN: /^[a-z0-9-]+$/,
  MAX_NAME_LENGTH: 50,
  MAX_DESCRIPTION_LENGTH: 200,
} as const;
