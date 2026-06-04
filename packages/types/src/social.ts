// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Shapes for the social layer that sits on top of posts: notifications and
 * trending tags.
 */
import type { NotificationType } from '@counter/config';
import type { PublicUser } from './user.ts';
import type { Post } from './post.ts';

/** One notification: who did what, and the post it concerns (if any). */
export interface Notification {
  id: string;
  type: NotificationType; // like / repost / reply / follow ...
  actor: PublicUser; // the user whose action triggered this
  post: Post | null; // the post involved; null for post-less events like a follow
  read: boolean;
  createdAt: string;
}

/** A hashtag currently trending, with how many posts are driving it. */
export interface TrendingTag {
  name: string;
  postCount: number;
}
