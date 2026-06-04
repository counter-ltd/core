import { db, posts, follows, sql, eq, and, or, lt, desc, isNull, inArray } from '@counter/db';
import { ALGORITHM } from '@counter/config';

export interface FeedPage {
  ids: string[];
  nextCursor: string | null;
}

const { weights, parameters } = ALGORITHM;

/**
 * The public ranking score, expressed in SQL so ranking happens in the database.
 * This is the open algorithm: recency decay plus weighted public engagement.
 * No personalization, no per-user signal — the same post scores the same for
 * everyone. Weights come from the ALGORITHM constant exposed at GET /algorithm.
 */
function scoreSql() {
  return sql`(
    ${sql.raw(String(weights.recency))} * power(
      0.5,
      (extract(epoch from (now() - ${posts.createdAt})) / 3600.0) / ${sql.raw(String(weights.recencyHalfLifeHours))}
    )
    + ${sql.raw(String(weights.likes))} * (select count(*) from likes l where l.post_id = ${posts.id})
    + ${sql.raw(String(weights.reposts))} * (select count(*) from reposts r where r.post_id = ${posts.id})
    + ${sql.raw(String(weights.replies))} * (select count(*) from posts c where c.parent_id = ${posts.id} and c.deleted = false)
  )`;
}

/**
 * Ranked public feed. Top-level, non-deleted posts within the max-age window,
 * ordered by algorithm score. Keyset pagination on (score, id): the cursor is
 * the last post id, whose score we recompute to fetch the next page.
 */
export async function rankedPublicFeed(opts: {
  after?: string;
  limit: number;
}): Promise<FeedPage> {
  const { after, limit } = opts;
  const score = scoreSql();

  const ageWindow = sql`${posts.createdAt} > now() - ${sql.raw(`interval '${parameters.maxAgeHours} hours'`)}`;
  const base = and(eq(posts.deleted, false), isNull(posts.parentId), ageWindow);

  let where = base;
  if (after) {
    // Recompute the cursor post's score to continue the keyset scan.
    const cursorRows = await db
      .select({ score: score.as('score'), id: posts.id })
      .from(posts)
      .where(eq(posts.id, after))
      .limit(1);
    const cursor = cursorRows[0];
    if (cursor) {
      const cursorScore = Number(cursor.score);
      where = and(
        base,
        or(
          lt(score, sql`${sql.raw(String(cursorScore))}`),
          and(sql`${score} = ${sql.raw(String(cursorScore))}`, lt(posts.id, after)),
        ),
      );
    }
  }

  const rows = await db
    .select({ id: posts.id, score: score.as('score') })
    .from(posts)
    .where(where)
    .orderBy(desc(score), desc(posts.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    ids: page.map((r) => r.id),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/**
 * Authenticated home feed: top-level posts from people you follow, plus your
 * own, reverse-chronological. Keyset by created_at then id for stability.
 */
export async function followingFeed(opts: {
  viewerId: string;
  after?: string;
  limit: number;
}): Promise<FeedPage> {
  const { viewerId, after, limit } = opts;

  const followingRows = await db
    .select({ id: follows.followingId })
    .from(follows)
    .where(eq(follows.followerId, viewerId));
  const authorIds = [...followingRows.map((r) => r.id), viewerId];

  const base = and(
    inArray(posts.userId, authorIds),
    eq(posts.deleted, false),
    isNull(posts.parentId),
  );

  let where = base;
  if (after) {
    const cursorRows = await db
      .select({ createdAt: posts.createdAt })
      .from(posts)
      .where(eq(posts.id, after))
      .limit(1);
    const cursor = cursorRows[0];
    if (cursor) {
      where = and(
        base,
        or(
          lt(posts.createdAt, cursor.createdAt),
          and(eq(posts.createdAt, cursor.createdAt), lt(posts.id, after)),
        ),
      );
    }
  }

  const rows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(where)
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    ids: page.map((r) => r.id),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}
