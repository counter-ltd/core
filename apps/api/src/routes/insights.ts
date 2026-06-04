// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Analytics endpoints: how a post did, how a profile is doing, how the whole
 * platform is doing.
 *
 * The privacy line runs through all three. Post and platform stats are public
 * because they're built from anonymous aggregate counts that can't be traced
 * back to a viewer. Profile stats are the one private view, gated to the
 * signed-in owner looking at their own numbers.
 */
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

/**
 * Unwrap a single-row count query into a plain number.
 *
 * `count()` comes back as an array of one row, and the driver hands the value
 * over as a string for big integers, so we coalesce the empty case to 0 and
 * force a Number rather than trust either.
 */
async function scalarCount(qb: Promise<Array<{ value: number }>>): Promise<number> {
  const rows = await qb;
  return Number(rows[0]?.value ?? 0);
}

/**
 * Per-post insights, public from the moment a post exists. There's no follower
 * gate here, by design: every author sees the same numbers on day one. The data
 * is anonymous aggregate view counts plus already-public engagement, so nothing
 * here exposes who did what.
 */
insightRoutes.get('/posts/:id', async (c) => {
  const id = c.req.param('id');
  const post = await db.query.posts.findFirst({ where: eq(posts.id, id) });
  // Treat a soft-deleted post as gone so we don't serve stats for it.
  if (!post || post.deleted) throw errors.notFound('Post not found');

  // One trip for the per-referrer view breakdown, three more for the engagement
  // tallies, all fired together since none depends on another's result.
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

  // Seed every known referrer at zero so the response always has the full set
  // of keys, even the ones with no views, and the client can render a stable
  // chart without filling gaps itself.
  const viewsByReferrer = Object.fromEntries(
    VIEW_REFERRERS.map((r) => [r, 0]),
  ) as Record<ViewReferrer, number>;
  let views = 0;
  for (const row of viewRows) {
    const n = Number(row.value);
    views += n;
    // A null referrer (or any value we don't recognise) folds into 'direct' so
    // stray or legacy rows still count toward the total instead of vanishing.
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
    // Null rather than 0 when there are no views: a brand-new post hasn't
    // "failed" to engage anyone yet, and dividing by zero would be a lie.
    engagementRate: views > 0 ? engagements / views : null,
    createdAt: post.createdAt.toISOString(),
  };
  return c.json(result);
});

/**
 * The one private analytics view: the signed-in user's own profile totals.
 * requireAuth pins it to whoever is logged in, and every query below filters by
 * that same userId, so there's no way to ask for someone else's numbers.
 */
insightRoutes.get('/profile', requireAuth, async (c) => {
  const userId = requireUserId(c);

  // A subquery of the caller's post ids, reused below to scope view/like/repost
  // counts to their content without round-tripping the ids back to the app.
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
      // The five most-viewed live posts, for the "top posts" strip. Grouped by
      // body as well as id so the body survives the GROUP BY and rides back out
      // without a second lookup.
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

/**
 * Platform-wide totals for a public "by the numbers" panel. No auth, because
 * these are headline counts (users, posts, views, and so on) that name nobody.
 */
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
