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
 * Online status and last-seen visibility and heartbeat constraints.
 *
 * Both features are off by default. Visibility controls who can see each one
 * independently. The heartbeat interval is user-configurable within the bounds
 * below; the server adds a 30-second grace window on top when deciding "online".
 */
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
