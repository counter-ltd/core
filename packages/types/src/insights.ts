import type { ViewReferrer } from '@counter/config';

/** Per-post insights. Available from post one — no follower gate, ever. */
export interface PostInsights {
  postId: string;
  views: number;
  viewsByReferrer: Record<ViewReferrer, number>;
  likes: number;
  reposts: number;
  replies: number;
  /** Engagements / views, 0..1. Null when there are no views yet. */
  engagementRate: number | null;
  createdAt: string;
}

export interface ProfileInsights {
  totalPosts: number;
  totalViews: number;
  totalLikes: number;
  totalReposts: number;
  totalReplies: number;
  followers: number;
  following: number;
  /** Most-viewed posts, capped server-side. */
  topPosts: Array<{ postId: string; body: string | null; views: number }>;
}

/** Platform-wide aggregate stats. Public, no auth. No individual is identifiable. */
export interface PublicInsights {
  users: number;
  posts: number;
  views: number;
  likes: number;
  reposts: number;
}
