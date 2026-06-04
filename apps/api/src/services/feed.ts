// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The two feeds: the ranked public timeline and the chronological following
 * feed. Both return a page of post ids plus a cursor for the next page.
 *
 * Both feeds page with keyset (cursor) pagination rather than OFFSET. The
 * difference matters at scale: OFFSET makes the database walk and discard every
 * row it skips, so deep pages get slower and slower, and a post inserted
 * mid-scroll shifts every later page by one. Keyset instead says "give me the
 * rows that sort after this exact one", which stays fast and stable no matter
 * how far down you are or what got inserted while you read.
 */
import { db, posts, follows, sql, eq, and, or, lt, desc, isNull, inArray } from '@counter/db';
import { ALGORITHM } from '@counter/config';

/** A page of feed results: post ids in order, plus the cursor for the next page. */
export interface FeedPage {
  ids: string[];
  /**
   * The id of the last post on this page, to pass back as `after` to continue.
   * Null when this is the final page, which is how the caller knows to stop.
   */
  nextCursor: string | null;
}

const { weights, parameters } = ALGORITHM;

/**
 * The public ranking score, built as a SQL fragment so ranking happens in the
 * database next to the data instead of pulling every candidate post into JS.
 *
 * This is the open algorithm: recency decay plus weighted public engagement.
 * No personalization, no per-user signal, so the same post scores the same for
 * everyone. The weights come from the ALGORITHM constant, the same one served
 * at GET /algorithm, so the ranking we run matches the one we publish.
 *
 * The recency term is exponential half-life decay: `0.5 ^ (ageHours /
 * halfLife)` is worth a full `recency` weight at age zero and halves every
 * `recencyHalfLifeHours`, so fresh posts win on equal engagement.
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
 * The ranked public feed: top-level, non-deleted posts within the max-age
 * window, ordered by the algorithm score above.
 *
 * Paginates by keyset on the (score, id) pair. Score alone isn't a stable sort
 * key because two posts can tie, so id is the tie-breaker that guarantees a
 * total order and keeps any single post from being skipped or repeated across
 * pages.
 *
 * @param after  Cursor: the id of the last post the caller already has.
 * @param limit  Page size. We fetch one extra row to detect a next page.
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
    // The score isn't stored, it's computed, so the cursor can only be a post
    // id. Re-run the scoring SQL for that one post to recover the (score, id)
    // pair the next page has to start after.
    const cursorRows = await db
      .select({ score: score.as('score'), id: posts.id })
      .from(posts)
      .where(eq(posts.id, after))
      .limit(1);
    const cursor = cursorRows[0];
    if (cursor) {
      const cursorScore = Number(cursor.score);
      // "Strictly after the cursor in (score desc, id desc) order": either a
      // lower score, or the same score with a smaller id. This mirrors the
      // orderBy exactly; if the two ever disagree, rows get dropped or doubled.
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

  // Asking for limit+1 rows is the cheap way to know if more exist: if the extra
  // row came back there's another page, and we drop it before returning.
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    ids: page.map((r) => r.id),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/**
 * The authenticated home feed: top-level posts from people you follow plus your
 * own, newest first. No ranking here, just reverse-chronological.
 *
 * Same keyset technique as the public feed, but on (created_at, id). created_at
 * isn't unique (two posts can land in the same millisecond), so id is again the
 * tie-breaker that makes the sort total.
 *
 * @param viewerId  Whose follow graph defines the feed; their own posts are in too.
 */
export async function followingFeed(opts: {
  viewerId: string;
  after?: string;
  limit: number;
}): Promise<FeedPage> {
  const { viewerId, after, limit } = opts;

  // Include viewerId alongside everyone they follow, so your own posts show up
  // in your home feed without needing to follow yourself.
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
    // created_at is a stored column, so unlike the ranked feed we can read the
    // cursor's sort value directly instead of recomputing anything.
    const cursorRows = await db
      .select({ createdAt: posts.createdAt })
      .from(posts)
      .where(eq(posts.id, after))
      .limit(1);
    const cursor = cursorRows[0];
    if (cursor) {
      // Same "strictly after the cursor" shape as the ranked feed, on
      // (created_at desc, id desc): older, or same instant with a smaller id.
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
