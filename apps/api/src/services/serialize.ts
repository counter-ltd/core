// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Turning raw database rows into the API's public shapes: PublicUser and Post.
 *
 * Everything here is built to serialize a whole batch of ids at once, not one
 * row at a time. A feed page is dozens of posts, each with an author, counts,
 * media, tags, and viewer flags. Done naively that's an N+1 explosion of
 * queries. Instead each serializer runs a fixed handful of aggregate queries
 * over the entire id set in parallel, then stitches the results together in
 * memory. The query count stays flat no matter how big the page is.
 */
import {
  db,
  users,
  posts,
  media,
  likes,
  reposts,
  follows,
  postViews,
  postTags,
  tags,
  topics,
  conversations,
  eq,
  and,
  inArray,
  isNull,
  count,
  asc,
} from '@counter/db';
import { PRESENCE } from '@counter/config';
import type { PresenceVisibility } from '@counter/config';
import type { PublicUser, Post, MediaItem, TopicRef, ConversationRef, UserPresence, DiscordShareMeta } from '@counter/types';

const iso = (d: Date) => d.toISOString();

/**
 * Check whether `viewerId` is allowed to see a presence field for `userId`
 * given the user's configured visibility setting.
 *
 * @param visibility   The user's chosen visibility option.
 * @param viewerId     The person asking; undefined for unauthenticated requests.
 * @param userId       The profile being viewed.
 * @param viewerFollowsUser  True when the viewer follows the profile owner.
 * @param userFollowsViewer  True when the profile owner follows the viewer back.
 */
function presenceVisible(
  visibility: string,
  viewerId: string | undefined,
  userId: string,
  viewerFollowsUser: boolean,
  userFollowsViewer: boolean,
): boolean {
  // A user always sees their own presence status regardless of settings.
  if (viewerId === userId) return true;
  if (visibility === 'everyone') return true;
  if (!viewerId) return false; // 'followers' and 'mutualFollowers' require login
  if (visibility === 'followers') return viewerFollowsUser;
  // 'mutualFollowers': viewer follows user AND user follows viewer back.
  if (visibility === 'mutualFollowers') return viewerFollowsUser && userFollowsViewer;
  return false;
}

/**
 * Fold the rows of a `GROUP BY ... count()` query into an id → count lookup.
 *
 * The count comes back as a bigint and arrives as a string from the driver, so
 * Number() coerces it to a usable number on the way in.
 */
function toCountMap(rows: Array<{ id: string; value: number }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.id, Number(r.value));
  return m;
}

/**
 * Serialize a batch of users into their public projection: profile fields plus
 * post / follower / following counts, plus viewer-relative flags when a viewer
 * is given.
 *
 * Returns a Map keyed by user id rather than an array, so callers can look up
 * exactly the users they need and in whatever order they want. Ids absent from
 * the database simply won't appear in the map.
 *
 * @param viewerId  The signed-in user. When set, each result carries a `viewer`
 *                  block (isFollowing / isSelf); when absent it's omitted, which
 *                  is how the same function serves both public and authed routes.
 */
export async function serializeUsers(
  userIds: string[],
  viewerId?: string,
): Promise<Map<string, PublicUser>> {
  // Dedupe first: a feed page can mention the same author many times, and there's
  // no point querying or building them twice.
  const ids = [...new Set(userIds)];
  const result = new Map<string, PublicUser>();
  if (ids.length === 0) return result;

  // One query per aggregate, all fired in parallel. The alternative, a single
  // join with several counts, fans out rows and double-counts; separate grouped
  // counts keep each number honest.
  const [rows, postCounts, followerCounts, followingCounts, viewerFollows, userFollowsViewer] =
    await Promise.all([
      db.select().from(users).where(inArray(users.id, ids)),
      // Post count is top-level posts only: replies (parentId set) and deleted
      // posts don't count toward the number shown on a profile.
      db
        .select({ id: posts.userId, value: count() })
        .from(posts)
        .where(and(inArray(posts.userId, ids), eq(posts.deleted, false), isNull(posts.parentId)))
        .groupBy(posts.userId),
      // A follows row reads "followerId follows followingId". So a user's follower
      // count is the rows where they're the followingId (people pointing at them),
      // and their following count is the rows where they're the followerId. Easy
      // to flip; the grouped key is what disambiguates the two queries below.
      db
        .select({ id: follows.followingId, value: count() })
        .from(follows)
        .where(inArray(follows.followingId, ids))
        .groupBy(follows.followingId),
      db
        .select({ id: follows.followerId, value: count() })
        .from(follows)
        .where(inArray(follows.followerId, ids))
        .groupBy(follows.followerId),
      // Only worth a query when there's a viewer to relate to. With no viewer we
      // resolve an empty array so the Promise.all shape stays the same either way.
      viewerId
        ? db
            .select({ id: follows.followingId })
            .from(follows)
            .where(and(eq(follows.followerId, viewerId), inArray(follows.followingId, ids)))
        : Promise.resolve([] as Array<{ id: string }>),
      // "Which batch users follow the viewer back" — needed for 'mutualFollowers'
      // presence visibility. Same empty-array fallback when there's no viewer.
      viewerId
        ? db
            .select({ id: follows.followerId })
            .from(follows)
            .where(and(inArray(follows.followerId, ids), eq(follows.followingId, viewerId)))
        : Promise.resolve([] as Array<{ id: string }>),
    ]);

  const postMap = toCountMap(postCounts);
  const followerMap = toCountMap(followerCounts);
  const followingMap = toCountMap(followingCounts);
  const followingSet = new Set(viewerFollows.map((r) => r.id));
  const followsBackSet = new Set(userFollowsViewer.map((r) => r.id));

  const now = Date.now();

  for (const u of rows) {
    // Compute online status: the user is online if the last heartbeat arrived
    // within their configured interval plus a grace window for network jitter.
    const onlineThresholdMs = (u.heartbeatIntervalSeconds + PRESENCE.ONLINE_GRACE_SECONDS) * 1000;
    const isOnline =
      u.onlineStatusEnabled &&
      u.lastSeenAt !== null &&
      now - u.lastSeenAt.getTime() < onlineThresholdMs;

    const viewerFollowsUser = followingSet.has(u.id);
    const profileUserFollowsViewer = followsBackSet.has(u.id);

    const canSeeOnline =
      u.onlineStatusEnabled &&
      presenceVisible(
        u.onlineStatusVisibility,
        viewerId,
        u.id,
        viewerFollowsUser,
        profileUserFollowsViewer,
      );
    const canSeeLastSeen =
      u.lastSeenEnabled &&
      presenceVisible(
        u.lastSeenVisibility as PresenceVisibility,
        viewerId,
        u.id,
        viewerFollowsUser,
        profileUserFollowsViewer,
      );

    // presence is null when nothing is visible to this viewer; the field is
    // included so clients can tell "disabled" from "not loaded".
    const presence: UserPresence | null =
      canSeeOnline || canSeeLastSeen
        ? {
            isOnline: canSeeOnline ? isOnline : false,
            lastSeenAt: canSeeLastSeen && u.lastSeenAt ? iso(u.lastSeenAt) : null,
          }
        : null;

    result.set(u.id, {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      bio: u.bio,
      avatarUrl: u.avatarUrl,
      verified: u.verified,
      createdAt: iso(u.createdAt),
      counts: {
        posts: postMap.get(u.id) ?? 0,
        followers: followerMap.get(u.id) ?? 0,
        following: followingMap.get(u.id) ?? 0,
      },
      ...(viewerId
        ? {
            viewer: {
              isFollowing: followingSet.has(u.id),
              isSelf: u.id === viewerId,
              // Only the account holder needs to know their own setting; everyone
              // else's value would be meaningless noise in the response.
              ...(u.id === viewerId ? { onlineStatusEnabled: u.onlineStatusEnabled } : {}),
            },
          }
        : {}),
      presence,
    });
  }

  return result;
}

/**
 * Serialize a batch of conversations into the minimal ConversationRef a message
 * notification needs: the conversation id plus the partner, the participant who
 * isn't the viewer.
 *
 * Returns a Map keyed by conversation id. Conversations the viewer isn't part of
 * (shouldn't happen for their own notifications) and ones with a missing partner
 * are simply absent from the map.
 *
 * @param viewerId  The notification recipient, used to pick the other side as
 *                  the partner.
 */
export async function serializeConversationRefs(
  conversationIds: string[],
  viewerId: string,
): Promise<Map<string, ConversationRef>> {
  const ids = [...new Set(conversationIds)];
  const result = new Map<string, ConversationRef>();
  if (ids.length === 0) return result;

  const rows = await db.select().from(conversations).where(inArray(conversations.id, ids));

  // The partner is whichever participant isn't the viewer. Gather those ids and
  // serialize them in one batch so partners load with full profile + counts.
  const partnerByConv = new Map<string, string>();
  for (const conv of rows) {
    const partnerId = conv.participantA === viewerId ? conv.participantB : conv.participantA;
    partnerByConv.set(conv.id, partnerId);
  }
  const partners = await serializeUsers([...partnerByConv.values()], viewerId);

  for (const conv of rows) {
    const partner = partners.get(partnerByConv.get(conv.id)!);
    if (!partner) continue;
    result.set(conv.id, { id: conv.id, partner });
  }
  return result;
}

/**
 * Serialize a batch of posts by id into the full Post shape: author, engagement
 * counts, media, tags, viewer flags, one level of repost nesting, and up to two
 * top replies for feed display.
 *
 * Returns a Map keyed by id; the caller decides final ordering (see
 * serializePostList). Missing ids are simply absent from the map.
 *
 * @param viewerId   When set, each post gets a `viewer` block (liked / reposted);
 *                   the authors it loads are serialized with the same viewer.
 * @param replyDepth How many levels of reply preview to attach. 2 (the default)
 *                   gives a direct reply plus one nested reply-to-a-reply, which
 *                   is what feed and profile cards show. Each recursion drops the
 *                   depth by one, so it bottoms out instead of recursing forever.
 *                   Pass 0 from the thread view, which lists every reply in full
 *                   and would only duplicate them in a preview.
 */
export async function serializePosts(
  postIds: string[],
  viewerId?: string,
  replyDepth = 2,
): Promise<Map<string, Post>> {
  const ids = [...new Set(postIds)];
  const result = new Map<string, Post>();
  if (ids.length === 0) return result;

  const primaryRows = await db.select().from(posts).where(inArray(posts.id, ids));

  // A repost points at the post it shares via repostOf. We embed that target one
  // level deep, so it has to be loaded too. Skip targets already in the request
  // (filtered by !ids.includes) to avoid fetching the same row twice; the flat
  // map below will already have them.
  const repostTargetIds = primaryRows
    .map((p) => p.repostOf)
    .filter((id): id is string => !!id && !ids.includes(id));
  const targetRows = repostTargetIds.length
    ? await db.select().from(posts).where(inArray(posts.id, repostTargetIds))
    : [];

  // From here on, work over primaries + their repost targets together, so a
  // nested target gets its own author, counts, and media just like a top post.
  const allRows = [...primaryRows, ...targetRows];
  const allIds = allRows.map((p) => p.id);
  const authorIds = allRows.map((p) => p.userId);

  const topicIds = [...new Set(allRows.map((p) => p.topicId).filter((id): id is string => !!id))];

  // Every aggregate the Post shape needs, fanned out over the full id set in one
  // parallel batch. serializeUsers is in here too, so authors load concurrently
  // with the counts rather than after them.
  const [
    authors,
    likeCounts,
    repostCounts,
    replyCounts,
    viewCounts,
    mediaRows,
    tagRows,
    topicRows,
    viewerLikes,
    viewerReposts,
  ] = await Promise.all([
    serializeUsers(authorIds, viewerId),
    db
      .select({ id: likes.postId, value: count() })
      .from(likes)
      .where(inArray(likes.postId, allIds))
      .groupBy(likes.postId),
    db
      .select({ id: reposts.postId, value: count() })
      .from(reposts)
      .where(inArray(reposts.postId, allIds))
      .groupBy(reposts.postId),
    // Replies are just posts whose parentId is one of ours. Group by parentId to
    // get a reply count per post; deleted replies are excluded from the tally.
    db
      .select({ id: posts.parentId, value: count() })
      .from(posts)
      .where(and(inArray(posts.parentId, allIds), eq(posts.deleted, false)))
      .groupBy(posts.parentId),
    db
      .select({ id: postViews.postId, value: count() })
      .from(postViews)
      .where(inArray(postViews.postId, allIds))
      .groupBy(postViews.postId),
    db.select().from(media).where(inArray(media.postId, allIds)),
    db
      .select({ postId: postTags.postId, name: tags.name })
      .from(postTags)
      .innerJoin(tags, eq(postTags.tagId, tags.id))
      .where(inArray(postTags.postId, allIds)),
    topicIds.length
      ? db.select().from(topics).where(inArray(topics.id, topicIds))
      : Promise.resolve([] as Array<{ id: string; slug: string; name: string }>),
    // Which of these posts the viewer has liked / reposted, for the filled-in
    // heart and repost icons. One row per hit, so the result is just a presence
    // set rather than a count. No viewer means no query, same as serializeUsers.
    viewerId
      ? db
          .select({ id: likes.postId })
          .from(likes)
          .where(and(eq(likes.userId, viewerId), inArray(likes.postId, allIds)))
      : Promise.resolve([] as Array<{ id: string }>),
    viewerId
      ? db
          .select({ id: reposts.postId })
          .from(reposts)
          .where(and(eq(reposts.userId, viewerId), inArray(reposts.postId, allIds)))
      : Promise.resolve([] as Array<{ id: string }>),
  ]);

  const likeMap = toCountMap(likeCounts);
  const repostMap = toCountMap(repostCounts);
  // parentId is nullable in the schema, but every row here came from a non-null
  // inArray match, so the cast to string is safe.
  const replyMap = toCountMap(replyCounts.map((r) => ({ id: r.id as string, value: r.value })));
  const viewMap = toCountMap(viewCounts);
  const likedSet = new Set(viewerLikes.map((r) => r.id));
  const repostedSet = new Set(viewerReposts.map((r) => r.id));

  const topicMap = new Map<string, TopicRef>();
  for (const t of topicRows) topicMap.set(t.id, { id: t.id, slug: t.slug, name: t.name });

  const mediaByPost = new Map<string, MediaItem[]>();
  for (const m of mediaRows) {
    const list = mediaByPost.get(m.postId) ?? [];
    list.push({
      id: m.id,
      url: m.url,
      mimeType: m.mimeType,
      width: m.width,
      height: m.height,
      sizeBytes: m.sizeBytes,
      altText: m.altText,
    });
    mediaByPost.set(m.postId, list);
  }

  const tagsByPost = new Map<string, string[]>();
  for (const t of tagRows) {
    const list = tagsByPost.get(t.postId) ?? [];
    list.push(t.name);
    tagsByPost.set(t.postId, list);
  }

  // Two-pass assembly. First build every post flat, with repostOf left null, so
  // both primaries and repost targets exist as finished objects in one map. The
  // second pass can then point a repost at its already-built target instead of
  // serializing it again or worrying about ordering.
  const flat = new Map<string, Post>();
  for (const p of allRows) {
    const author = authors.get(p.userId);
    if (!author) continue; // author row missing (shouldn't happen); skip defensively
    flat.set(p.id, {
      id: p.id,
      // A deleted post keeps its row (so replies still thread) but its content is
      // blanked: no body, no media. The deleted flag lets the client tombstone it.
      body: p.deleted ? null : p.body,
      // sourceMeta is blanked on deleted posts same as body, so the card
      // content doesn't outlive the rest of the post.
      sourceMeta: p.deleted ? null : ((p.sourceMeta as DiscordShareMeta | null) ?? null),
      author,
      parentId: p.parentId,
      repostOf: null,
      topic: p.topicId ? (topicMap.get(p.topicId) ?? null) : null,
      edited: p.edited,
      deleted: p.deleted,
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
      media: p.deleted ? [] : mediaByPost.get(p.id) ?? [],
      tags: tagsByPost.get(p.id) ?? [],
      counts: {
        likes: likeMap.get(p.id) ?? 0,
        reposts: repostMap.get(p.id) ?? 0,
        replies: replyMap.get(p.id) ?? 0,
        views: viewMap.get(p.id) ?? 0,
      },
      ...(viewerId
        ? { viewer: { liked: likedSet.has(p.id), reposted: repostedSet.has(p.id) } }
        : {}),
    });
  }

  // Second pass: only the originally requested ids go in the result (a repost
  // target pulled in for nesting isn't itself a result unless it was asked for).
  // Attach each repost's target, forcing its own repostOf to null so nesting
  // stops at one level and can't recurse into a chain of reposts-of-reposts.
  for (const p of primaryRows) {
    const post = flat.get(p.id);
    if (!post) continue;
    if (p.repostOf) {
      const target = flat.get(p.repostOf);
      post.repostOf = target ? { ...target, repostOf: null } : null;
    }
    // Backstop for orphaned bare reposts: a post with no body and no surviving
    // repost target has nothing to show. That happens when its target was
    // hard-deleted and the FK set-null fired. Tombstone it so clients render the
    // deleted placeholder instead of an empty card.
    if (!post.deleted && post.body === null && post.repostOf === null) {
      post.deleted = true;
    }
    result.set(p.id, post);
  }

  // Top replies: fetch the two oldest direct replies for each primary post that
  // has any, so feed clients can show a thread preview without a second request.
  // Each fetched reply is serialized one depth shallower, so its own topReplies
  // give the nested reply-to-a-reply preview, then the chain stops at depth 0.
  if (replyDepth > 0) {
    const postsWithReplies = primaryRows
      .filter((p) => (replyMap.get(p.id) ?? 0) > 0)
      .map((p) => p.id);

    if (postsWithReplies.length > 0) {
      // One query for all replies across all feed posts; group in JS and take the
      // two oldest per parent. Fetching the full reply body upfront is cheaper
      // than N round-trips, and feed pages are small enough that the full set is
      // rarely more than a few dozen rows.
      const replyIdRows = await db
        .select({ parentId: posts.parentId, id: posts.id })
        .from(posts)
        .where(and(inArray(posts.parentId, postsWithReplies), eq(posts.deleted, false)))
        .orderBy(asc(posts.createdAt), asc(posts.id));

      const replyIdsByParent = new Map<string, string[]>();
      for (const row of replyIdRows) {
        const parentId = row.parentId as string;
        const list = replyIdsByParent.get(parentId) ?? [];
        if (list.length < 2) {
          list.push(row.id);
          replyIdsByParent.set(parentId, list);
        }
      }

      const allReplyIds = [...replyIdsByParent.values()].flat();
      if (allReplyIds.length > 0) {
        // One level shallower, so a direct reply still carries its own nested
        // reply but the grandchildren stop there.
        const replyPostMap = await serializePosts(allReplyIds, viewerId, replyDepth - 1);
        for (const [parentId, replyIds] of replyIdsByParent) {
          const parent = result.get(parentId);
          if (!parent) continue;
          parent.topReplies = replyIds
            .map((id) => replyPostMap.get(id))
            .filter((p): p is Post => !!p);
        }
      }
    }
  }

  return result;
}

/**
 * Serialize an ordered list of post ids back into an ordered array of Posts.
 *
 * serializePosts returns an unordered Map, but feeds care about order, so this
 * walks the original id list to restore it. Ids that didn't serialize (deleted
 * between ranking and now, say) drop out rather than leaving holes in the array.
 */
export async function serializePostList(
  orderedIds: string[],
  viewerId?: string,
): Promise<Post[]> {
  const map = await serializePosts(orderedIds, viewerId);
  return orderedIds.map((id) => map.get(id)).filter((p): p is Post => !!p);
}
