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
  eq,
  and,
  inArray,
  isNull,
  count,
} from '@counter/db';
import type { PublicUser, Post, MediaItem } from '@counter/types';

const iso = (d: Date) => d.toISOString();

/** Build a Map of postId/userId → count from a grouped-count query. */
function toCountMap(rows: Array<{ id: string; value: number }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.id, Number(r.value));
  return m;
}

/**
 * Serialize users into their public projection, with follower/following/post
 * counts and viewer-relative flags. Batched: one query per aggregate.
 */
export async function serializeUsers(
  userIds: string[],
  viewerId?: string,
): Promise<Map<string, PublicUser>> {
  const ids = [...new Set(userIds)];
  const result = new Map<string, PublicUser>();
  if (ids.length === 0) return result;

  const [rows, postCounts, followerCounts, followingCounts, viewerFollows] = await Promise.all([
    db.select().from(users).where(inArray(users.id, ids)),
    db
      .select({ id: posts.userId, value: count() })
      .from(posts)
      .where(and(inArray(posts.userId, ids), eq(posts.deleted, false), isNull(posts.parentId)))
      .groupBy(posts.userId),
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
    viewerId
      ? db
          .select({ id: follows.followingId })
          .from(follows)
          .where(and(eq(follows.followerId, viewerId), inArray(follows.followingId, ids)))
      : Promise.resolve([] as Array<{ id: string }>),
  ]);

  const postMap = toCountMap(postCounts);
  const followerMap = toCountMap(followerCounts);
  const followingMap = toCountMap(followingCounts);
  const followingSet = new Set(viewerFollows.map((r) => r.id));

  for (const u of rows) {
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
        ? { viewer: { isFollowing: followingSet.has(u.id), isSelf: u.id === viewerId } }
        : {}),
    });
  }

  return result;
}

/**
 * Serialize posts by id into the full Post shape: author, counts, media, tags,
 * viewer flags, and one level of repost nesting. Order is the caller's concern.
 */
export async function serializePosts(
  postIds: string[],
  viewerId?: string,
): Promise<Map<string, Post>> {
  const ids = [...new Set(postIds)];
  const result = new Map<string, Post>();
  if (ids.length === 0) return result;

  const primaryRows = await db.select().from(posts).where(inArray(posts.id, ids));

  // Pull in repost targets (one level) so we can nest them.
  const repostTargetIds = primaryRows
    .map((p) => p.repostOf)
    .filter((id): id is string => !!id && !ids.includes(id));
  const targetRows = repostTargetIds.length
    ? await db.select().from(posts).where(inArray(posts.id, repostTargetIds))
    : [];

  const allRows = [...primaryRows, ...targetRows];
  const allIds = allRows.map((p) => p.id);
  const authorIds = allRows.map((p) => p.userId);

  const [
    authors,
    likeCounts,
    repostCounts,
    replyCounts,
    viewCounts,
    mediaRows,
    tagRows,
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
  const replyMap = toCountMap(replyCounts.map((r) => ({ id: r.id as string, value: r.value })));
  const viewMap = toCountMap(viewCounts);
  const likedSet = new Set(viewerLikes.map((r) => r.id));
  const repostedSet = new Set(viewerReposts.map((r) => r.id));

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

  // First build flat (un-nested) posts for everything we loaded.
  const flat = new Map<string, Post>();
  for (const p of allRows) {
    const author = authors.get(p.userId);
    if (!author) continue; // author row missing (shouldn't happen); skip defensively
    flat.set(p.id, {
      id: p.id,
      body: p.deleted ? null : p.body,
      author,
      parentId: p.parentId,
      repostOf: null,
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

  // Attach nested repost targets and assemble the result for requested ids.
  for (const p of primaryRows) {
    const post = flat.get(p.id);
    if (!post) continue;
    if (p.repostOf) {
      const target = flat.get(p.repostOf);
      post.repostOf = target ? { ...target, repostOf: null } : null;
    }
    result.set(p.id, post);
  }

  return result;
}

/** Convenience: serialize an ordered id list, preserving order, dropping misses. */
export async function serializePostList(
  orderedIds: string[],
  viewerId?: string,
): Promise<Post[]> {
  const map = await serializePosts(orderedIds, viewerId);
  return orderedIds.map((id) => map.get(id)).filter((p): p is Post => !!p);
}
