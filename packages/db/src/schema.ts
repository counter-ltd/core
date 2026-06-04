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
  jsonb,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// People with accounts. username and email are both unique; passwordHash holds
// the PBKDF2 string (format defined by the API's hasher, mirrored in seed.ts).
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  displayName: text('display_name'),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  verified: boolean('verified').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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

// Images and other attachments hanging off a post. The bytes live in S3; this
// table holds the URL and metadata. userId is denormalized from the post so
// ownership checks don't need a join.
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
    read: boolean('read').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Composite (user, createdAt) so a user's notifications come back already
  // ordered newest-first without a separate sort step.
  (t) => [index('notifications_user_id_idx').on(t.userId, t.createdAt)],
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

// Row type helpers the API builds queries and responses around. $inferSelect is
// a full row; $inferInsert is what you need to insert (defaults optional).
// Insert types only exist for tables the app actually inserts into by hand.
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type EmailVerification = typeof emailVerifications.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Media = typeof media.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Theme = typeof themes.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type ProfileTheme = typeof profileThemes.$inferSelect;
export type AlgorithmChangelog = typeof algorithmChangelog.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;
export type TopicMember = typeof topicMembers.$inferSelect;
