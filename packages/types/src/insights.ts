// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Analytics shapes at three scopes: a single post, a whole profile, and the
 * platform as a whole.
 *
 * Counter gives everyone full analytics from day one. There's no follower
 * threshold to unlock them, which is why none of these carry a gate flag.
 */
import type { ViewReferrer } from '@counter/config';

/** Stats for one post. Available from a creator's very first post, no gating. */
export interface PostInsights {
  postId: string;
  views: number;
  viewsByReferrer: Record<ViewReferrer, number>; // where the views came from (feed, profile, link...)
  likes: number;
  reposts: number;
  replies: number;
  /** Engagements / views, clamped 0..1. Null until the post has any views (avoids divide-by-zero). */
  engagementRate: number | null;
  createdAt: string;
}

/** Rolled-up stats for a whole profile, shown on the creator's own dashboard. */
export interface ProfileInsights {
  totalPosts: number;
  totalViews: number;
  totalLikes: number;
  totalReposts: number;
  totalReplies: number;
  followers: number;
  following: number;
  /** The profile's best performers by views; the server caps how many it returns. */
  topPosts: Array<{ postId: string; body: string | null; views: number }>;
}

/**
 * Headline numbers for the whole platform. Public and unauthenticated: these
 * are pure aggregates, so no single user can be picked out of them.
 */
export interface PublicInsights {
  users: number;
  posts: number;
  views: number;
  likes: number;
  reposts: number;
}
