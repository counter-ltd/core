// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The full Counter data model: every table, its columns, indexes, and foreign
 * keys, plus the row types the API builds on. This is the single source of truth
 * that drizzle-kit turns into migrations.
 *
 * Conventions worth knowing before you read on:
 *  - Column names are snake_case in Postgres; the TS fields are camelCase.
 *  - Posts soft-delete (set `deleted = true`) rather than DELETE, so a reply
 *    keeps its parent reference even after the parent is gone.
 *  - Most foreign keys cascade on delete, so removing a user tears down their
 *    posts, likes, follows, and so on. Where we'd rather keep the row and just
 *    drop the link, we use `set null` instead; each case is noted below.
 *
 * See documents/DATA-MODEL.md for the entity-relationship narrative.
 */
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  jsonb,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// People with accounts. passwordHash holds the PBKDF2 string (format defined by
// the API's hasher, mirrored in seed.ts). Null for OAuth-only accounts that have
// never set a password.
//
// `email` is encrypted at rest (AES-256-GCM, `v1:` envelope) so a database dump
// never spills addresses in plain text. The ciphertext is randomised per write
// and so can't be queried; `emailIndex` holds a deterministic blind index (keyed
// HMAC of the lower-cased address) which carries the uniqueness constraint and
// every lookup at login / signup / OAuth-link. See lib/crypto.ts.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  displayName: text('display_name'),
  bio: text('bio'),
  // `avatarUrl` is the served value (what clients render). `avatarObjectId`
  // links the R2-backed blob behind it so we can refcount and garbage-collect
  // the object when the avatar is replaced. Null when the avatar is an external
  // URL (seed data, or never set), in which case nothing in R2 is held.
  avatarUrl: text('avatar_url'),
  avatarObjectId: uuid('avatar_object_id').references((): AnyPgColumn => mediaObjects.id, {
    onDelete: 'set null',
  }),
  email: text('email').notNull(),
  emailIndex: text('email_index').notNull().unique(),
  passwordHash: text('password_hash'),
  verified: boolean('verified').default(false).notNull(),
  // --- presence ---
  // Both features default off. Visibility controls who can see each one.
  onlineStatusEnabled: boolean('online_status_enabled').default(false).notNull(),
  onlineStatusVisibility: text('online_status_visibility').default('everyone').notNull(),
  lastSeenEnabled: boolean('last_seen_enabled').default(false).notNull(),
  lastSeenVisibility: text('last_seen_visibility').default('everyone').notNull(),
  // Updated by POST /users/me/heartbeat while online status or last seen is on.
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  heartbeatIntervalSeconds: integer('heartbeat_interval_seconds').default(300).notNull(),
  // --- messaging privacy ---
  // Controls who can start a new conversation with this user. 'everyone' allows
  // direct messages from anyone. 'followers' restricts direct messages to people
  // who follow this user; others must send a message request instead. 'nobody'
  // blocks all incoming messages and requests.
  messagingPrivacy: text('messaging_privacy').default('everyone').notNull(),
  // When on, this user's typing is relayed to the person they're chatting with
  // over the conversation socket. Defaults on so the indicator works out of the
  // box; the privacy toggle lets anyone opt out. Enforced server-side: the live
  // route reads this and the DO drops typing frames from users who turned it off,
  // so a patched client can't leak typing the user disabled.
  typingIndicatorsEnabled: boolean('typing_indicators_enabled').default(true).notNull(),
  // --- moderation status ---
  // 'active' for everyone normally; 'suspended' and 'banned' are set by admins
  // and block sign-in (enforced at login and token refresh). A suspension reads
  // `suspendedUntil` for its expiry; a ban is indefinite and leaves it null.
  status: text('status').default('active').notNull(), // USER_STATUSES in @counter/config
  statusReason: text('status_reason'),
  suspendedUntil: timestamp('suspended_until', { withTimezone: true }),
  // --- bot accounts ---
  // Null for every normal (human) account. A non-null value marks this account
  // as a server-designated bot and names its persona (e.g. 'thing_one'); the
  // mention-reply pipeline keys off it. This is the bot allowlist: it is only
  // ever set server-side (migration, seed, or direct SQL), never through any API
  // surface, so an open-source client cannot promote an arbitrary account to a
  // bot. Bot accounts also cannot be DMed (enforced at the message route).
  botKind: text('bot_kind'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Permission groups. A group carries a subset of the fixed PERMISSION_KEYS
// (@counter/config) in its jsonb `permissions` array; a user's effective set is
// the union across every group they belong to. `isSystem` groups (admin,
// moderator) can be renamed and re-permissioned but never deleted, so a site
// can't lock itself out of its own admin panel.
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    // Array of permission keys. jsonb (not a join table) because the set is
    // small, always read whole, and validated against the code-side enum on write.
    permissions: jsonb('permissions').$type<string[]>().notNull(),
    // A colour token for the group's badge in the UI. Null falls back to a default.
    color: text('color'),
    isSystem: boolean('is_system').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('groups_slug_idx').on(t.slug)],
);

// Group memberships. Join table, many-to-many: a user can hold several groups
// and a group has many members. `assignedBy` records which admin granted it for
// the audit trail; it set-nulls if that admin's account is later deleted.
export const userGroups = pgTable(
  'user_groups',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // PK (user, group) keeps a membership unique and answers "this user's groups"
    // fast; the reverse index serves "members of this group".
    primaryKey({ columns: [t.userId, t.groupId] }),
    index('user_groups_group_id_idx').on(t.groupId),
  ],
);

// Append-only record of every privileged action an admin takes. Nothing here is
// ever updated or deleted in normal operation, so it's the trustworthy answer to
// "who did what". actorId set-nulls (rather than cascades) so the log outlives
// the admin account that wrote it; targetId is plain text because the thing it
// points at (a post, a user, a group) may itself be gone by the time you read.
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(), // e.g. 'user.ban', 'group.update', 'post.remove'
    targetType: text('target_type'), // 'user' | 'post' | 'group' | 'report'
    targetId: text('target_id'),
    // One-line human summary, rendered straight in the log view.
    summary: text('summary').notNull(),
    // Optional structured before/after or extra context, shown on expand.
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // The log view reads newest-first; the actor index serves "this admin's actions".
    index('admin_audit_log_created_at_idx').on(t.createdAt),
    index('admin_audit_log_actor_id_idx').on(t.actorId),
  ],
);

// User-submitted reports about a post or another user, feeding the moderation
// queue. reporterId set-nulls so a report survives the reporter deleting their
// account; resolvedBy records which moderator closed it.
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    targetType: text('target_type').notNull(), // REPORT_TARGET_TYPES in @counter/config
    targetId: uuid('target_id').notNull(),
    reason: text('reason').notNull(), // REPORT_REASONS
    detail: text('detail'),
    status: text('status').default('open').notNull(), // REPORT_STATUSES
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Queue view: open reports newest-first, served from (status, createdAt).
    index('reports_status_idx').on(t.status, t.createdAt),
    // "All reports about this thing", for the detail panel and dedupe.
    index('reports_target_idx').on(t.targetType, t.targetId),
  ],
);

// Active login sessions, one row per refresh token. We store only the hash of
// the token, never the token itself, so a database leak can't be replayed.
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      // Deleting a user logs them out everywhere by taking their sessions with them.
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Null until the session is first used to refresh; updated on each refresh.
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    // Unique so a token hash maps to exactly one session, and so refresh lookups
    // by token hit an index instead of scanning.
    uniqueIndex('sessions_token_hash_idx').on(t.tokenHash),
    // Speeds up "all sessions for this user" when listing or revoking them.
    index('sessions_user_id_idx').on(t.userId),
  ],
);

// Pending email-verification tokens, one row per outstanding request. Like
// sessions, we store only the token's hash, so a database leak can't be used to
// verify someone's address. Verifying is optional: it sets users.verified (the
// ✦ badge), it never gates anything, which keeps us on the right side of the
// CSL's ban on engagement/threshold gates.
export const emailVerifications = pgTable(
  'email_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      // Deleting a user drops any pending verification with them.
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Unique so a token hash maps to one request and lookups by token hit an index.
    uniqueIndex('email_verifications_token_hash_idx').on(t.tokenHash),
    // "the pending token(s) for this user", for reissuing and cleanup.
    index('email_verifications_user_id_idx').on(t.userId),
  ],
);

// Pending password-reset tokens, one row per outstanding request. Same shape as
// email_verifications: we store only the SHA-256 of a high-entropy random token,
// never the token itself, so a database leak can't be replayed to seize an
// account. Redeeming sets a fresh password_hash and burns every token for the
// user. TTL is short (one hour) because a reset link is a far more dangerous
// credential than a verify link.
export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      // Deleting a user drops any pending reset with them.
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Unique so a token hash maps to one request and lookups by token hit an index.
    uniqueIndex('password_resets_token_hash_idx').on(t.tokenHash),
    // "the pending token(s) for this user", for reissuing, cooldown, and cleanup.
    index('password_resets_user_id_idx').on(t.userId),
  ],
);

// Named spaces posts can belong to, addressed by a URL-friendly slug.
export const topics = pgTable(
  'topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    // set null, not cascade: if the creator's account goes, the topic stays for
    // everyone else, it just loses its attribution.
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Indexed lookup for /t/:slug routes.
  (t) => [uniqueIndex('topics_slug_idx').on(t.slug)],
);

// Who has joined which topic. Join table, so the row is the membership itself.
export const topicMembers = pgTable(
  'topic_members',
  {
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Composite PK (topic, user) makes membership unique and gives a fast
    // "members of this topic" lookup for free.
    primaryKey({ columns: [t.topicId, t.userId] }),
    // The reverse direction, "topics this user is in", which the PK can't serve.
    index('topic_members_user_id_idx').on(t.userId),
  ],
);

// The central content table. One row is a post, a reply, or a repost; which one
// it is comes from whether parentId / repostOf are set. Self-referencing twice,
// hence the AnyPgColumn type hints to break the circular reference.
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Nullable because a pure repost carries no text of its own.
    body: text('body'),
    // Set when this post is a reply. set null on parent delete so a soft-deleted
    // or removed parent doesn't drag the reply down with it; the thread survives.
    parentId: uuid('parent_id').references((): AnyPgColumn => posts.id, {
      onDelete: 'set null',
    }),
    // Set when this post reposts another. Same set-null reasoning as parentId.
    repostOf: uuid('repost_of').references((): AnyPgColumn => posts.id, {
      onDelete: 'set null',
    }),
    // Optional topic the post lives in; deleting the topic just unfiles the post.
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    edited: boolean('edited').default(false).notNull(),
    // Soft-delete flag. We hide the post but keep the row so replies and reposts
    // that point at it stay valid.
    deleted: boolean('deleted').default(false).notNull(),
    // True when a moderator removed the post (as opposed to the author deleting
    // it). Both set `deleted`, but this distinguishes the two so the author can't
    // un-remove a moderated post and the moderation queue can show its state.
    removedByAdmin: boolean('removed_by_admin').default(false).notNull(),
    // Structured metadata for posts created via integrations (e.g. "Share to
    // Counter" from Discord). Null for regular posts. Clients that understand
    // it render a rich card; others fall back to the text body as-is.
    sourceMeta: jsonb('source_meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // A post indexed every way the app reads it: by author (profiles), by parent
    // (threads), by repostOf (repost counts), by topic (topic feeds), and by
    // createdAt (the chronological backbone of the ranked feed).
    index('posts_user_id_idx').on(t.userId),
    index('posts_parent_id_idx').on(t.parentId),
    index('posts_repost_of_idx').on(t.repostOf),
    index('posts_topic_id_idx').on(t.topicId),
    index('posts_created_at_idx').on(t.createdAt),
  ],
);

// The physical layer of media storage: one row per unique blob in R2, keyed by
// the sha256 of its bytes (which is also the R2 object key, `objects/{sha256}`).
// Content-addressing means identical bytes collapse to a single object: the same
// Discord avatar shared by ten users, or the same image posted twice, is stored
// once. `refCount` tracks how many things point at this object (post media rows,
// user avatars, cached Discord profiles); when it falls to 0 the cron sweep
// deletes the object after a grace window. See services/media.ts.
export const mediaObjects = pgTable(
  'media_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Lower-case hex sha256 of the stored bytes. Unique so dedup is a single
    // indexed lookup on upload, and it doubles as the R2 key suffix.
    sha256: text('sha256').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    // Best-effort, parsed from the image header at upload. Null when the format
    // wasn't one we sniff dimensions for.
    width: integer('width'),
    height: integer('height'),
    // How many references hold this object alive. Starts at 0 on upload (the
    // blob exists but nothing points at it yet), so an upload that's never
    // attached is reclaimed by the sweep.
    refCount: integer('ref_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Bumped on every ref change. The sweep keys off this so a freshly-uploaded
    // object gets a grace window before it's eligible for deletion.
    lastReferencedAt: timestamp('last_referenced_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // The GC sweep scans for refCount 0 ordered by age, so index both together.
  (t) => [index('media_objects_gc_idx').on(t.refCount, t.lastReferencedAt)],
);

// Images and other attachments hanging off a post. The bytes live in R2 behind
// a `media_objects` row; this table holds the served URL and per-attachment
// metadata. userId is denormalized from the post so ownership checks don't need
// a join. `objectId` links the physical blob so deleting the post can drop its
// refcount; null only for legacy/external rows that predate R2.
export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id').references(() => mediaObjects.id, { onDelete: 'set null' }),
    url: text('url').notNull(),
    mimeType: text('mime_type').notNull(),
    // Dimensions and size are nullable: not every upload reports them, and they
    // aren't known until processing finishes.
    width: integer('width'),
    height: integer('height'),
    sizeBytes: integer('size_bytes'),
    altText: text('alt_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Fetch all media for a post in one indexed hit when rendering it.
  (t) => [index('media_post_id_idx').on(t.postId)],
);

// The follow graph: follower follows following. Both columns point at users, so
// deleting either side removes the edge.
export const follows = pgTable(
  'follows',
  {
    followerId: uuid('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followingId: uuid('following_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // PK (follower, following) keeps each follow unique and answers "who does X
    // follow" fast (the following list).
    primaryKey({ columns: [t.followerId, t.followingId] }),
    // The other direction, "who follows X" (followers), which the PK can't index.
    index('follows_following_id_idx').on(t.followingId),
  ],
);

// One row per like. The composite PK enforces "one like per user per post" at
// the database level, so a double-tap can't double-count.
export const likes = pgTable(
  'likes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postId] }),
    // Index by post so counting/listing a post's likes doesn't scan the table.
    index('likes_post_id_idx').on(t.postId),
  ],
);

// One row per repost. Same shape and one-per-user-per-post guarantee as likes.
// The posts table also gets a repostOf row for the repost itself; this is the
// lightweight edge used for counts and "did I repost this".
export const reposts = pgTable(
  'reposts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postId] }),
    index('reposts_post_id_idx').on(t.postId),
  ],
);

// Hashtag vocabulary, deduped by unique name. The link to posts is post_tags.
export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Many-to-many join between posts and tags.
export const postTags = pgTable(
  'post_tags',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    // PK (post, tag) makes the pairing unique and lists a post's tags fast.
    primaryKey({ columns: [t.postId, t.tagId] }),
    // The reverse, "posts with this tag", for tag pages.
    index('post_tags_tag_id_idx').on(t.tagId),
  ],
);

// Things that happened to a user: userId is the recipient, actorId is who did it
// (the liker, follower, replier). Both cascade, so deleting either party clears
// the notification.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // see NOTIFICATION_TYPES in @counter/config
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The post involved, if any (a follow has none). set null keeps the
    // notification around even after the post goes away.
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'set null' }),
    // The conversation involved, set only for `message` notifications so the
    // client can open the right thread. Cascade: if the conversation is gone
    // (account deleted), the notification has nowhere to point and goes too.
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'cascade',
    }),
    read: boolean('read').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Composite (user, createdAt) so a user's notifications come back already
  // ordered newest-first without a separate sort step.
  (t) => [index('notifications_user_id_idx').on(t.userId, t.createdAt)],
);

// A user's muted notification types. Presence of a row means "don't send me
// this type", on any channel. Absence means on, so every account defaults to
// all-on with no backfill and no per-user row to create up front.
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // a NOTIFICATION_TYPES value; the row's presence = muted
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // PK (user, type) keeps each mute unique and answers "what has this user
  // muted" in one indexed hit, which is the only way we read this table.
  (t) => [primaryKey({ columns: [t.userId, t.type] })],
);

// Registered push devices, one row per APNs token. We store only the opaque
// token Apple gives us, never anything that describes the device or the person.
// Deleting the user takes their devices with them.
//
// `token` is encrypted at rest (AES-256-GCM, `v1:` envelope) so a dump can't be
// used to push spam to anyone's device. The APNs sender decrypts it just before
// the call to Apple. `tokenIndex` is the blind index (keyed HMAC of the raw
// token) that carries uniqueness and powers the upsert-on-reregister and the
// delete-on-signout, since the ciphertext itself isn't queryable.
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(), // see DEVICE_PLATFORMS in @counter/config ('ios')
    token: text('token').notNull(),
    tokenIndex: text('token_index').notNull(),
    // User-supplied label so multiple devices are distinguishable. Null for
    // devices registered before this column was added.
    name: text('name'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Bumped each time the same token re-registers, so stale devices are spottable.
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Unique on the blind index so re-registering upserts one row; a device
    // can't double up, and the conflict target has something queryable to hit.
    uniqueIndex('devices_token_idx').on(t.tokenIndex),
    // Fan-out lookup: every device for a user when delivering a push.
    index('devices_user_id_idx').on(t.userId),
  ],
);

// Browser Web Push subscriptions, the web equivalent of the iOS `devices` rows.
// One row per subscribed browser. The `endpoint` (the push service URL that
// uniquely identifies the browser to its push provider) is encrypted at rest the
// same way device tokens are, with a blind index carrying uniqueness and the
// upsert conflict target. `p256dh` and `auth` are the subscription's own public
// key and shared secret, the RFC 8291 inputs needed to encrypt each payload;
// they're useless to anyone without the matching endpoint, so they're stored
// as-is. Registration is opt-in, the same as devices.
export const webPushSubscriptions = pgTable(
  'web_push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Encrypted (v1: envelope). The push service URL we POST each push to.
    endpoint: text('endpoint').notNull(),
    // Blind index of the endpoint; carries uniqueness and the upsert target.
    endpointIndex: text('endpoint_index').notNull(),
    // base64url client public key (p256dh) and auth secret from the subscription.
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Unique on the blind index so re-subscribing the same browser upserts.
    uniqueIndex('web_push_subscriptions_endpoint_idx').on(t.endpointIndex),
    // Fan-out lookup: every subscription for a user when delivering a push.
    index('web_push_subscriptions_user_id_idx').on(t.userId),
  ],
);

/**
 * post_views, anonymous aggregate only. A view is a count, not a person.
 * NO user_id. NO ip. NO session_id. That constraint is load-bearing: it's the
 * privacy promise Counter makes, so don't add an identity column here.
 */
export const postViews = pgTable(
  'post_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).defaultNow().notNull(),
    // Free text but constrained in app code to VIEW_REFERRERS in @counter/config.
    referrer: text('referrer'), // 'feed' | 'profile' | 'search' | 'direct' | 'external'
  },
  // Index by post to total views per post; there's nothing else to query by.
  (t) => [index('post_views_post_id_idx').on(t.postId)],
);

// User-authored visual themes. `variables` is a jsonb bag of CSS custom
// properties (see seed.ts for the shape) so we can add design tokens without a
// migration each time.
export const themes = pgTable(
  'themes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    variables: jsonb('variables').notNull(),
    published: boolean('published').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Index on published so the public theme gallery skips private drafts cheaply.
  (t) => [index('themes_published_idx').on(t.published)],
);

// Links to a user's accounts on other platforms, shown on their profile.
export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    platformUsername: text('platform_username').notNull(),
    platformUrl: text('platform_url'),
    verified: boolean('verified').default(false).notNull(),
    // True when the user wants this badge visible on their public profile.
    // Defaults to true so a freshly-verified link shows immediately.
    displayed: boolean('displayed').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Unique on (user, platform) so a user can't link the same platform twice.
  (t) => [uniqueIndex('integrations_user_platform_idx').on(t.userId, t.platform)],
);

// Which theme a user has applied to their profile, plus any per-user overrides.
// userId is the primary key, so there's exactly one row per user.
export const profileThemes = pgTable('profile_themes', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  // set null: if the chosen theme is deleted, the user falls back to the default
  // rather than losing their profile_themes row and any customVariables on it.
  themeId: uuid('theme_id').references(() => themes.id, { onDelete: 'set null' }),
  customVariables: jsonb('custom_variables'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// A user's saved themes: the "saved from Browse" half of their Library. A user's
// own authored themes are found through themes.userId, so this table only records
// themes saved from someone else's gallery. The composite primary key on
// (userId, themeId) means a theme can be saved at most once per user.
export const savedThemes = pgTable(
  'saved_themes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    themeId: uuid('theme_id')
      .notNull()
      .references(() => themes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.themeId] })],
);

// Append-only history of changes to the ranking algorithm. Backs the public
// transparency log; commitHash ties each entry to the code that shipped it.
export const algorithmChangelog = pgTable('algorithm_changelog', {
  id: uuid('id').primaryKey().defaultRandom(),
  version: text('version').notNull(),
  summary: text('summary').notNull(),
  detail: text('detail'),
  // Free text, not a user FK: entries can be attributed to a team or 'counter'
  // and should outlive any individual account.
  changedBy: text('changed_by').notNull(),
  commitHash: text('commit_hash').notNull(),
  deployedAt: timestamp('deployed_at', { withTimezone: true }).defaultNow().notNull(),
});

// Per-device E2EE key pairs. One row per (user, device) pair. A user can have
// multiple registered devices, each with its own P-256 key pair; senders
// encrypt a separate copy of each message for every device so all of them can
// decrypt. device_id is a stable UUID generated on the device and stored in
// localStorage (web) or UserDefaults (iOS) alongside the private key.
export const deviceKeys = pgTable(
  'device_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Opaque identifier chosen by the client; stable across sessions so a
    // device that re-registers doesn't duplicate its key row.
    deviceId: text('device_id').notNull(),
    // SPKI base64 P-256 public key. The private half never leaves the device.
    publicKey: text('public_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Unique per (user, device) so re-registering the same device upserts
    // rather than inserting a duplicate row.
    uniqueIndex('device_keys_user_device_idx').on(t.userId, t.deviceId),
    // Lookup "all keys for this user" when building the encryption target list.
    index('device_keys_user_id_idx').on(t.userId),
  ],
);

// Registered passkeys (WebAuthn credentials). Unlike device_keys above, which is
// E2EE message encryption, these are an authentication factor: a passkey both
// registers (under an authenticated session) and later signs in passwordless.
// We store only the public key and the signature counter, never anything that
// could impersonate the authenticator. All the base64url strings come straight
// from @simplewebauthn and are stored verbatim.
export const webauthnCredentials = pgTable(
  'webauthn_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // base64url of the raw credential ID the authenticator returned. Unique, and
    // how an assertion is matched back to its stored key at login.
    credentialId: text('credential_id').notNull(),
    // base64url of the COSE public key. The verifier checks assertions against it.
    publicKey: text('public_key').notNull(),
    // Signature counter the authenticator reports. It only ever moves forward; a
    // value that goes backwards is the classic cloned-authenticator signal, so
    // the verifier rejects a regression. bigint because it can exceed int32.
    counter: bigint('counter', { mode: 'number' }).default(0).notNull(),
    // JSON array of transport hints (["internal","hybrid", ...]), used to give the
    // browser better autofill UI on the next ceremony. Null when unknown.
    transports: text('transports'),
    // 'singleDevice' | 'multiDevice' (backup eligibility). Display only.
    deviceType: text('device_type'),
    backedUp: boolean('backed_up').default(false).notNull(),
    // User-facing label so someone with several passkeys can tell them apart.
    nickname: text('nickname'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    // The credential ID is the lookup key at login and must be globally unique.
    uniqueIndex('webauthn_credentials_credential_id_idx').on(t.credentialId),
    // "All passkeys for this user" for the settings list and excludeCredentials.
    index('webauthn_credentials_user_id_idx').on(t.userId),
  ],
);

// Short-lived WebAuthn ceremony challenges. Mirrors oauthStates: one row per
// in-flight register/authenticate, consumed (deleted) when the ceremony
// finishes. A challenge is a single-use nonce, not a bearer credential, so it's
// stored in plaintext (useless without the matching private key) rather than
// hashed the way refresh tokens are.
export const webauthnChallenges = pgTable(
  'webauthn_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    challenge: text('challenge').notNull(),
    // Null for authentication (login) ceremonies: the user isn't known until the
    // assertion resolves a credential. Set for registration, which runs under an
    // authenticated session.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    // 'registration' | 'authentication'. Scopes a challenge to its ceremony so a
    // registration nonce can't be redeemed as a login and vice versa.
    ceremony: text('ceremony').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('webauthn_challenges_user_id_idx').on(t.userId)],
);

// Direct messages: one conversation row per pair of users, one message row per
// message. Participants are stored in lexicographic order (A < B UUID string
// comparison) so the unique index on (participantA, participantB) covers both
// directions and there can never be two conversations between the same pair.
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // App code sorts [userA, userB] before inserting, so participantA is always
    // the lexicographically smaller UUID. That invariant is what makes the unique
    // index below enforce one-row-per-pair rather than two.
    participantA: uuid('participant_a')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    participantB: uuid('participant_b')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Updated on every new message so the inbox can sort by most recent activity.
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Per-user clear: messages older than this timestamp are hidden for that participant.
    // Null means the user has never cleared.
    participantAClearedAt: timestamp('participant_a_cleared_at', { withTimezone: true }),
    participantBClearedAt: timestamp('participant_b_cleared_at', { withTimezone: true }),
    // Per-user delete: conversation is hidden from that participant's inbox.
    // The row stays so the other party still sees the thread.
    participantADeletedAt: timestamp('participant_a_deleted_at', { withTimezone: true }),
    participantBDeletedAt: timestamp('participant_b_deleted_at', { withTimezone: true }),
    // Message request state. 'active' is a normal two-way conversation; 'request'
    // means the initiator sent one message and is waiting for the recipient to
    // accept before either side can send more.
    status: text('status').default('active').notNull(),
    // The user who sent the initial message request. Null once the conversation
    // becomes active. SET NULL on user deletion so the row survives.
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    // The uniqueness guarantee: one conversation per ordered pair.
    uniqueIndex('conversations_participants_idx').on(t.participantA, t.participantB),
    // Inbox queries: "all conversations for user X sorted by activity", served
    // from each side's index without touching the other.
    index('conversations_participant_a_idx').on(t.participantA, t.lastMessageAt),
    index('conversations_participant_b_idx').on(t.participantB, t.lastMessageAt),
  ],
);

// Individual messages within a conversation. `read` starts false and flips when
// the recipient views the thread; the app only marks messages from the partner
// as read, never messages the viewer sent themselves.
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    // 'message' for normal messages; 'screenshot' for screenshot notifications;
    // 'cleared'/'deleted' for per-user history actions; 'tunnel_started'/
    // 'tunnel_ended' for Tunnel Talk session markers (linked via tunnelSessionId).
    kind: text('kind').notNull().default('message'),
    // Set when kind is 'tunnel_started' or 'tunnel_ended'. Links the system
    // message to its session so the thread can look up the transcript.
    // SET NULL so markers survive if the session row is somehow removed.
    tunnelSessionId: uuid('tunnel_session_id').references(() => tunnelSessions.id, {
      onDelete: 'set null',
    }),
    read: boolean('read').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Thread view: all messages in a conversation, ordered by time.
    index('messages_conversation_id_idx').on(t.conversationId, t.createdAt),
    // Unread-count queries: filter by (conversation, read=false) without a scan.
    index('messages_unread_idx').on(t.conversationId, t.read),
  ],
);

// A Tunnel Talk session between two users. Status flows: pending → active → ended
// (or pending → declined). SDP/ICE signals are never stored here; they pass
// through the signaling Durable Object and are discarded once the peer connection
// is established.
export const tunnelSessions = pgTable(
  'tunnel_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Deleting the conversation removes the session and cascades to tunnelMessages.
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    // SET NULL so the row survives account deletion; status/timestamps stay intact.
    initiatorId: uuid('initiator_id').references(() => users.id, { onDelete: 'set null' }),
    participantId: uuid('participant_id').references(() => users.id, { onDelete: 'set null' }),
    // 'pending': invite sent, waiting for participant.
    // 'active': both peers connected via WebRTC.
    // 'ended': session closed by either party.
    // 'declined': participant rejected the invite (or it expired).
    status: text('status').notNull().default('pending'),
    // Both default false. When both flip to true, the client-side WebRTC layer
    // starts buffering messages for upload after the session ends.
    initiatorConsent: boolean('initiator_consent').notNull().default(false),
    participantConsent: boolean('participant_consent').notNull().default(false),
    // Set when the WebRTC data channel opens (both peers connected).
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Pending-invite poll: "is there a pending session for this conversation?".
    index('tunnel_sessions_conversation_status_idx').on(t.conversationId, t.status),
    // User-scoped queries: "all sessions initiated by / involving this user".
    index('tunnel_sessions_initiator_idx').on(t.initiatorId),
    index('tunnel_sessions_participant_idx').on(t.participantId),
  ],
);

// Messages uploaded after a Tunnel Talk session ends, when both parties consented
// to saving the transcript. Bodies are the same E2EE ciphertext format as regular
// DMs — the server never sees plaintext. CASCADE DELETE is the revocation
// mechanism: deleting from this table (triggered by consent revocation or
// conversation deletion) removes the entire transcript atomically.
export const tunnelMessages = pgTable(
  'tunnel_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tunnelSessionId: uuid('tunnel_session_id')
      .notNull()
      // Revocation and conversation deletion both flow through this cascade.
      .references(() => tunnelSessions.id, { onDelete: 'cascade' }),
    // SET NULL so transcript rows survive account deletion (the body is
    // ciphertext anyway; sender identity in the UI comes from the body envelope).
    senderId: uuid('sender_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    // Client-provided timestamp from when the message was sent P2P, not when
    // it was uploaded. Uploaded in batches after session end.
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    // Transcript fetch: all messages for a session, ordered chronologically.
    index('tunnel_messages_session_sent_idx').on(t.tunnelSessionId, t.sentAt),
  ],
);

// OAuth accounts linked to a Counter user. One row per (user, provider) pair.
// Access and refresh tokens are stored encrypted with AES-256-GCM using the
// same MESSAGE_ENCRYPTION_KEY as message bodies (format: v1:<iv>:<ciphertext>).
export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      // Deleting a user removes their linked OAuth credentials.
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'github' | 'discord'
    providerUserId: text('provider_user_id').notNull(),
    providerUsername: text('provider_username'),
    // Encrypted at rest (AES-256-GCM, `v1:` envelope) like users.email. It's
    // display-only (shown on the settings page), never looked up by, so it needs
    // no blind index. Decrypted in the route just before it's returned.
    providerEmail: text('provider_email'),
    // Both tokens are encrypted at rest. refreshToken is null for providers
    // that don't issue one (GitHub classic tokens don't expire).
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // One Counter account per OAuth identity, so the same GitHub user can't log
    // into two different Counter accounts.
    uniqueIndex('oauth_accounts_provider_user_idx').on(t.provider, t.providerUserId),
    // One linked GitHub per Counter user — prevents linking the same platform twice.
    uniqueIndex('oauth_accounts_user_provider_idx').on(t.userId, t.provider),
    // "All linked accounts for this user" (settings page, disconnect).
    index('oauth_accounts_user_id_idx').on(t.userId),
  ],
);

// Short-lived CSRF state tokens for in-flight OAuth flows. One row per pending
// redirect; consumed (deleted) in the callback. Two actions share this table:
// 'login' for unauthenticated sign-in and 'connect' for linking an existing
// Counter account (userId is set for connect, null for login).
export const oauthStates = pgTable(
  'oauth_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stateHash: text('state_hash').notNull(),
    provider: text('provider').notNull(),
    action: text('action').notNull(), // 'login' | 'connect'
    // Null for login flows where no Counter session exists yet.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('oauth_states_state_hash_idx').on(t.stateHash)],
);

// One-time codes issued after a successful OAuth login, redeemed by the client
// via POST /auth/session/exchange to get a real JWT pair. Avoids putting tokens
// in any URL. Only used for the 'login' action (the 'connect' action redirects
// back to the already-logged-in session, so no code is needed).
export const oauthSessionCodes = pgTable(
  'oauth_session_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codeHash: text('code_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('oauth_session_codes_code_hash_idx').on(t.codeHash)],
);

// Opt-in Discord bot (Thing Two) notifications. One row per user; absence means
// the user has never enabled it. inGuild is cached from the bot membership check
// so we don't call Discord's API on every notification delivery.
export const discordBotSubscriptions = pgTable('discord_bot_subscriptions', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(false),
  // Cached from the guild membership check. False until the user enables and
  // passes the check; set false again if the bot gets a 403/404 on delivery.
  inGuild: boolean('in_guild').notNull().default(false),
  guildCheckedAt: timestamp('guild_checked_at', { withTimezone: true }),
  // Separate from notification delivery (enabled). A user can receive Counter
  // notifications on Discord without allowing the bot to post on their behalf.
  postingEnabled: boolean('posting_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Per-Discord-account avatar cache. Keyed by the Discord snowflake so there's
// exactly one row per account, which is what gives us "no duplicate account
// photos" and "replace the old one when it changes". `avatarHash` is Discord's
// own hash for the current avatar (null = they use a default avatar). When it
// differs from what we have, we fetch the new image into a `media_objects` blob,
// drop the old object's refcount, and point this row at the new one. The cached
// `username`/`globalName` save a round-trip when rendering attribution offline.
export const discordProfiles = pgTable('discord_profiles', {
  discordUserId: text('discord_user_id').primaryKey(),
  avatarHash: text('avatar_hash'),
  objectId: uuid('object_id').references(() => mediaObjects.id, { onDelete: 'set null' }),
  username: text('username'),
  globalName: text('global_name'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Row type helpers the API builds queries and responses around. $inferSelect is
// a full row; $inferInsert is what you need to insert (defaults optional).
// Insert types only exist for tables the app actually inserts into by hand.
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type EmailVerification = typeof emailVerifications.$inferSelect;
export type PasswordReset = typeof passwordResets.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Media = typeof media.$inferSelect;
export type MediaObject = typeof mediaObjects.$inferSelect;
export type NewMediaObject = typeof mediaObjects.$inferInsert;
export type DiscordProfile = typeof discordProfiles.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type Theme = typeof themes.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type ProfileTheme = typeof profileThemes.$inferSelect;
export type AlgorithmChangelog = typeof algorithmChangelog.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;
export type TopicMember = typeof topicMembers.$inferSelect;
export type DeviceKey = typeof deviceKeys.$inferSelect;
export type NewDeviceKey = typeof deviceKeys.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type OAuthState = typeof oauthStates.$inferSelect;
export type OAuthSessionCode = typeof oauthSessionCodes.$inferSelect;
export type DiscordBotSubscription = typeof discordBotSubscriptions.$inferSelect;
export type TunnelSession = typeof tunnelSessions.$inferSelect;
export type NewTunnelSession = typeof tunnelSessions.$inferInsert;
export type TunnelMessage = typeof tunnelMessages.$inferSelect;
export type NewTunnelMessage = typeof tunnelMessages.$inferInsert;
export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type UserGroup = typeof userGroups.$inferSelect;
export type NewUserGroup = typeof userGroups.$inferInsert;
export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLog.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
