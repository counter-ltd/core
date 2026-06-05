// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Everything to do with posts: the write schemas the API validates against and
 * the read shapes it returns. Covers top-level posts, replies, reposts/quotes,
 * attached media, and the thread view that stitches a post to its context.
 */
import { z } from 'zod';
import { POST, VIEW_REFERRERS } from '@counter/config';
import type { PublicUser } from './user.ts';
import type { TopicRef } from './topic.ts';

// Shared by create/reply/update. Trimmed first, so a body of only whitespace
// fails the min(1) check rather than sneaking through as "empty but present".
const bodySchema = z
  .string()
  .trim()
  .min(1, 'A post needs a body or media')
  .max(POST.MAX_BODY_LENGTH);

/**
 * One attachment as the client references it when creating a post.
 *
 * The client no longer supplies a free-form `url`: it first uploads the bytes
 * to POST /media (which validates and stores them) and then attaches the
 * returned object id here. The server resolves the URL, dimensions, and MIME
 * from that object, so a caller can't point a post at arbitrary external media.
 * `altText` stays client-supplied since it's per-attachment, not per-blob.
 */
export const mediaInputSchema = z.object({
  objectId: z.string().uuid(),
  altText: z.string().max(1000).optional(), // accessibility description
});
export type MediaInput = z.infer<typeof mediaInputSchema>;

/** What POST /media returns after validating and storing an upload. */
export interface MediaUploadResponse {
  /** The `media_objects` id to attach to a post or set as an avatar. */
  id: string;
  /** Public URL the bytes are served from. */
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
}

/**
 * Structured metadata for a post created by sharing a Discord message.
 * Stored in `posts.source_meta`; used by clients to render a quote card.
 * Falls back gracefully: clients that don't understand this field can render
 * the plain text body instead.
 */
export interface DiscordShareMeta {
  type: 'discord_share';
  /** Original message text from Discord. */
  content: string;
  /** Discord display name (global_name or username). */
  authorName: string;
  /** Discriminator tag, e.g. "1234". Null for accounts on the new username system. */
  authorDiscordTag: string | null;
  /** Discord snowflake ID — used to build the profile link. */
  authorDiscordId: string;
  /** Counter username when the author has a linked account, otherwise null. */
  authorCounterUsername: string | null;
  /**
   * URL of the author's Discord avatar, ingested into our own media storage so
   * the card doesn't hotlink Discord's CDN. Null when they use a default avatar
   * or the fetch failed (the card falls back to initials).
   */
  authorAvatarUrl: string | null;
}

/** Body for creating a top-level post (or a repost/quote of another post). */
export const createPostSchema = z.object({
  body: bodySchema,
  /** Set to repost an existing post; pair it with a body to make it a quote. */
  repostOf: z.string().uuid().optional(),
  /** Scope the post to a topic instead of the general feed. */
  topicId: z.string().uuid().optional(),
  media: z.array(mediaInputSchema).max(4).optional(), // up to 4 attachments
});
export type CreatePostInput = z.infer<typeof createPostSchema>;

/** Body for replying to a post. Same fields as a post minus repost/topic. */
export const createReplySchema = z.object({
  body: bodySchema,
  media: z.array(mediaInputSchema).max(4).optional(),
});
export type CreateReplyInput = z.infer<typeof createReplySchema>;

/** Body for editing a post. Only the text is editable; media and topic are fixed. */
export const updatePostSchema = z.object({
  body: bodySchema,
});
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

/** Optional `?ref=` tag when reading a post, so anonymous views can be attributed. */
export const viewReferrerSchema = z.enum(VIEW_REFERRERS);

/** A stored attachment as it comes back on a post (nullable dims for non-images). */
export interface MediaItem {
  id: string;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  altText: string | null;
}

/** Engagement tallies shown on a post. */
export interface PostCounts {
  likes: number;
  reposts: number;
  replies: number;
  views: number;
}

/** A post as the API returns it, with author, relations, media, and counts hydrated. */
export interface Post {
  id: string;
  body: string | null; // null for a bare repost that carries no quote text
  /** Rich card metadata set when this post was created via an integration. */
  sourceMeta: DiscordShareMeta | null;
  author: PublicUser;
  parentId: string | null; // set when this post is a reply; null for top-level
  repostOf: Post | null; // the original when this is a repost/quote, else null
  topic: TopicRef | null;
  edited: boolean;
  deleted: boolean; // tombstoned post; kept so threads don't lose their shape
  createdAt: string;
  updatedAt: string;
  media: MediaItem[];
  tags: string[]; // hashtags extracted from the body
  counts: PostCounts;
  /** This viewer's relationship to the post. Present only when authenticated. */
  viewer?: {
    liked: boolean;
    reposted: boolean;
  };
  /**
   * Up to two of the oldest direct replies, pre-fetched for feed display.
   * Omitted when there are no replies; absent on reply posts themselves.
   */
  topReplies?: Post[];
}

/** A post plus its conversation: everything above it and the replies below. */
export interface Thread {
  ancestors: Post[]; // root-first chain up to the focused post
  post: Post;
  replies: Post[];
}
