import { Hono } from 'hono';
import {
  db,
  posts,
  users,
  likes,
  reposts,
  follows,
  postViews,
  eq,
  and,
  desc,
  count,
  inArray,
} from '@counter/db';
import { VIEW_REFERRERS, type ViewReferrer } from '@counter/config';
import type { PostInsights, ProfileInsights, PublicInsights } from '@counter/types';
import { errors } from '../lib/errors.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import type { AppEnv } from '../types.ts';

export const insightRoutes = new Hono<AppEnv>();

async function scalarCount(qb: Promise<Array<{ value: number }>>): Promise<number> {
  const rows = await qb;
  return Number(rows[0]?.value ?? 0);
}

/**
 * Per-post insights. Public and available from post one — no follower gate, ever.
 * Built entirely from anonymous aggregate view counts and public engagement.
 */
insightRoutes.get('/posts/:id', async (c) => {
  const id = c.req.param('id');
  const post = await db.query.posts.findFirst({ where: eq(posts.id, id) });
  if (!post || post.deleted) throw errors.notFound('Post not found');

  const [viewRows, likeCount, repostCount, replyCount] = await Promise.all([
    db
      .select({ referrer: postViews.referrer, value: count() })
      .from(postViews)
      .where(eq(postViews.postId, id))
      .groupBy(postViews.referrer),
    scalarCount(
      db.select({ value: count() }).from(likes).where(eq(likes.postId, id)),
    ),
    scalarCount(
      db.select({ value: count() }).from(reposts).where(eq(reposts.postId, id)),
    ),
    scalarCount(
      db
        .select({ value: count() })
        .from(posts)
        .where(and(eq(posts.parentId, id), eq(posts.deleted, false))),
    ),
  ]);

  const viewsByReferrer = Object.fromEntries(
    VIEW_REFERRERS.map((r) => [r, 0]),
  ) as Record<ViewReferrer, number>;
  let views = 0;
  for (const row of viewRows) {
    const n = Number(row.value);
    views += n;
    const key = (row.referrer ?? 'direct') as ViewReferrer;
    if (key in viewsByReferrer) viewsByReferrer[key] += n;
    else viewsByReferrer.direct += n;
  }

  const engagements = likeCount + repostCount + replyCount;
  const result: PostInsights = {
    postId: id,
    views,
    viewsByReferrer,
    likes: likeCount,
    reposts: repostCount,
    replies: replyCount,
    engagementRate: views > 0 ? engagements / views : null,
    createdAt: post.createdAt.toISOString(),
  };
  return c.json(result);
});

/** Aggregate insights for the authenticated user's own profile. */
insightRoutes.get('/profile', requireAuth, async (c) => {
  const userId = requireUserId(c);

  const ownPostIds = db.select({ id: posts.id }).from(posts).where(eq(posts.userId, userId));

  const [totalPosts, totalViews, totalLikes, totalReposts, totalReplies, followerCount, followingCount, topRows] =
    await Promise.all([
      scalarCount(
        db
          .select({ value: count() })
          .from(posts)
          .where(and(eq(posts.userId, userId), eq(posts.deleted, false))),
      ),
      scalarCount(
        db.select({ value: count() }).from(postViews).where(inArray(postViews.postId, ownPostIds)),
      ),
      scalarCount(
        db.select({ value: count() }).from(likes).where(inArray(likes.postId, ownPostIds)),
      ),
      scalarCount(
        db.select({ value: count() }).from(reposts).where(inArray(reposts.postId, ownPostIds)),
      ),
      scalarCount(
        db
          .select({ value: count() })
          .from(posts)
          .where(and(inArray(posts.parentId, ownPostIds), eq(posts.deleted, false))),
      ),
      scalarCount(
        db.select({ value: count() }).from(follows).where(eq(follows.followingId, userId)),
      ),
      scalarCount(
        db.select({ value: count() }).from(follows).where(eq(follows.followerId, userId)),
      ),
      db
        .select({ postId: postViews.postId, body: posts.body, value: count() })
        .from(postViews)
        .innerJoin(posts, eq(posts.id, postViews.postId))
        .where(and(eq(posts.userId, userId), eq(posts.deleted, false)))
        .groupBy(postViews.postId, posts.body)
        .orderBy(desc(count()))
        .limit(5),
    ]);

  const result: ProfileInsights = {
    totalPosts,
    totalViews,
    totalLikes,
    totalReposts,
    totalReplies,
    followers: followerCount,
    following: followingCount,
    topPosts: topRows.map((r) => ({ postId: r.postId, body: r.body, views: Number(r.value) })),
  };
  return c.json(result);
});

/** Platform-wide aggregate stats. Public. No individual is ever identifiable. */
insightRoutes.get('/public', async (c) => {
  const [userCount, postCount, viewCount, likeCount, repostCount] = await Promise.all([
    scalarCount(db.select({ value: count() }).from(users)),
    scalarCount(
      db.select({ value: count() }).from(posts).where(eq(posts.deleted, false)),
    ),
    scalarCount(db.select({ value: count() }).from(postViews)),
    scalarCount(db.select({ value: count() }).from(likes)),
    scalarCount(db.select({ value: count() }).from(reposts)),
  ]);

  const result: PublicInsights = {
    users: userCount,
    posts: postCount,
    views: viewCount,
    likes: likeCount,
    reposts: repostCount,
  };
  return c.json(result);
});
