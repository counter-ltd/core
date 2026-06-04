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

/**
 * Counter's complete data model. This file is the open-source source of truth
 * referenced by DATA-MODEL.md. No hidden columns, no shadow tables.
 *
 * Column names are snake_case in Postgres; the TS field names are camelCase.
 */

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

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_idx').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
  ],
);

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body'),
    parentId: uuid('parent_id').references((): AnyPgColumn => posts.id, {
      onDelete: 'set null',
    }),
    repostOf: uuid('repost_of').references((): AnyPgColumn => posts.id, {
      onDelete: 'set null',
    }),
    edited: boolean('edited').default(false).notNull(),
    deleted: boolean('deleted').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('posts_user_id_idx').on(t.userId),
    index('posts_parent_id_idx').on(t.parentId),
    index('posts_repost_of_idx').on(t.repostOf),
    index('posts_created_at_idx').on(t.createdAt),
  ],
);

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
    width: integer('width'),
    height: integer('height'),
    sizeBytes: integer('size_bytes'),
    altText: text('alt_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('media_post_id_idx').on(t.postId)],
);

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
    primaryKey({ columns: [t.followerId, t.followingId] }),
    index('follows_following_id_idx').on(t.followingId),
  ],
);

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
    index('likes_post_id_idx').on(t.postId),
  ],
);

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

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

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
    primaryKey({ columns: [t.postId, t.tagId] }),
    index('post_tags_tag_id_idx').on(t.tagId),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'like' | 'repost' | 'reply' | 'follow' | 'mention'
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'set null' }),
    read: boolean('read').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('notifications_user_id_idx').on(t.userId, t.createdAt)],
);

/**
 * post_views — anonymous aggregate only. A view is a count, not a person.
 * NO user_id. NO ip. NO session_id. This constraint is load-bearing.
 */
export const postViews = pgTable(
  'post_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).defaultNow().notNull(),
    referrer: text('referrer'), // 'feed' | 'profile' | 'search' | 'direct' | 'external'
  },
  (t) => [index('post_views_post_id_idx').on(t.postId)],
);

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
  (t) => [index('themes_published_idx').on(t.published)],
);

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
  (t) => [uniqueIndex('integrations_user_platform_idx').on(t.userId, t.platform)],
);

export const profileThemes = pgTable('profile_themes', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  themeId: uuid('theme_id').references(() => themes.id, { onDelete: 'set null' }),
  customVariables: jsonb('custom_variables'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const algorithmChangelog = pgTable('algorithm_changelog', {
  id: uuid('id').primaryKey().defaultRandom(),
  version: text('version').notNull(),
  summary: text('summary').notNull(),
  detail: text('detail'),
  changedBy: text('changed_by').notNull(),
  commitHash: text('commit_hash').notNull(),
  deployedAt: timestamp('deployed_at', { withTimezone: true }).defaultNow().notNull(),
});

// Row type helpers for use across the API.
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Media = typeof media.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Theme = typeof themes.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type ProfileTheme = typeof profileThemes.$inferSelect;
export type AlgorithmChangelog = typeof algorithmChangelog.$inferSelect;
