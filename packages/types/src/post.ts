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

/** One uploaded attachment as the client describes it when creating a post. */
export const mediaInputSchema = z.object({
  url: z.string().url(),
  mimeType: z.string().min(1),
  width: z.number().int().positive().optional(), // pixels; omitted for non-image media
  height: z.number().int().positive().optional(),
  sizeBytes: z.number().int().positive().optional(),
  altText: z.string().max(1000).optional(), // accessibility description
});
export type MediaInput = z.infer<typeof mediaInputSchema>;

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
}

/** A post plus its conversation: everything above it and the replies below. */
export interface Thread {
  ancestors: Post[]; // root-first chain up to the focused post
  post: Post;
  replies: Post[];
}
