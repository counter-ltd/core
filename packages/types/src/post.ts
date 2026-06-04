import { z } from 'zod';
import { POST, VIEW_REFERRERS } from '@counter/config';
import type { PublicUser } from './user.ts';

const bodySchema = z
  .string()
  .trim()
  .min(1, 'A post needs a body or media')
  .max(POST.MAX_BODY_LENGTH);

export const mediaInputSchema = z.object({
  url: z.string().url(),
  mimeType: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  sizeBytes: z.number().int().positive().optional(),
  altText: z.string().max(1000).optional(),
});
export type MediaInput = z.infer<typeof mediaInputSchema>;

export const createPostSchema = z.object({
  body: bodySchema,
  /** Set to repost an existing post (optionally with a quote body). */
  repostOf: z.string().uuid().optional(),
  media: z.array(mediaInputSchema).max(4).optional(),
});
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const createReplySchema = z.object({
  body: bodySchema,
  media: z.array(mediaInputSchema).max(4).optional(),
});
export type CreateReplyInput = z.infer<typeof createReplySchema>;

export const updatePostSchema = z.object({
  body: bodySchema,
});
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

/** Optional referrer tagging when reading a post, used for anonymous view counts. */
export const viewReferrerSchema = z.enum(VIEW_REFERRERS);

export interface MediaItem {
  id: string;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  altText: string | null;
}

export interface PostCounts {
  likes: number;
  reposts: number;
  replies: number;
  views: number;
}

export interface Post {
  id: string;
  body: string | null;
  author: PublicUser;
  parentId: string | null;
  repostOf: Post | null;
  edited: boolean;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  media: MediaItem[];
  tags: string[];
  counts: PostCounts;
  /** Present only when authenticated. */
  viewer?: {
    liked: boolean;
    reposted: boolean;
  };
}

export interface Thread {
  ancestors: Post[];
  post: Post;
  replies: Post[];
}
