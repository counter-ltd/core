/**
 * Shared constants for the Counter platform.
 * These are values the API and clients must agree on. Nothing secret lives here.
 */

export const PAGINATION = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

export const RATE_LIMIT = {
  /** Requests allowed per window, per client. */
  LIMIT: 300,
  /** Window length in seconds. */
  WINDOW_SECONDS: 60,
} as const;

export const POST = {
  MAX_BODY_LENGTH: 5000,
} as const;

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

/** Where a post view came from. Anonymous — never tied to a person. */
export const VIEW_REFERRERS = ['feed', 'profile', 'search', 'direct', 'external'] as const;
export type ViewReferrer = (typeof VIEW_REFERRERS)[number];

export const NOTIFICATION_TYPES = ['like', 'repost', 'reply', 'follow', 'mention'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * The ranking algorithm. Public by design — Counter exposes this verbatim
 * through GET /algorithm. Editing these weights is editing the feed, in the open.
 */
export const ALGORITHM = {
  version: '1.0.0',
  description:
    'Chronological-leaning ranking with light engagement and recency signals. No personalization profile, no individual tracking. Score = base recency decay + weighted public engagement.',
  weights: {
    recency: 1.0,
    likes: 0.5,
    reposts: 0.8,
    replies: 0.6,
    /** Half-life of the recency decay, in hours. */
    recencyHalfLifeHours: 6,
  },
  parameters: {
    /** Posts older than this (hours) are excluded from the ranked feed. */
    maxAgeHours: 168,
    /** Reposts and replies are folded into the parent for ranking. */
    foldReplies: true,
  },
} as const;

export const ERROR_CODES = {
  VALIDATION: 'validation_error',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rate_limited',
  INTERNAL: 'internal_error',
} as const;
