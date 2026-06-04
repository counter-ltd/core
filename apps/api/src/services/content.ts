// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The side effects that fan out from a post's text: hashtags, @mentions,
 * notifications, and view ticks.
 *
 * When someone writes a post we have to do more than store the body. We scan it
 * for #hashtags and @handles, link those to the post, and ping the people who
 * got mentioned. This file is where that parsing and the resulting writes live.
 */
import {
  db,
  users,
  tags,
  postTags,
  notifications,
  postViews,
  eq,
  inArray,
} from '@counter/db';
import type { NotificationType, ViewReferrer } from '@counter/config';

// Hashtags allow any Unicode letter or number plus underscore, so tags in
// non-Latin scripts work. The `u` flag is what makes \p{L}/\p{N} legal.
const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;
// Mentions are stricter: usernames are ASCII-only, matching what signup allows.
const MENTION_RE = /@([a-z0-9_]+)/gi;

/**
 * Pull the unique hashtags out of a post body, lowercased.
 *
 * @returns  Tag names without the leading `#`. Deduped, so "#cat #Cat" yields
 *           one entry; tags are case-insensitive.
 */
export function extractHashtags(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(HASHTAG_RE)) {
    if (m[1]) found.add(m[1].toLowerCase());
  }
  return [...found];
}

/**
 * Pull the unique @mentioned usernames out of a post body, lowercased.
 *
 * @returns  Handles without the leading `@`, deduped and ready to match against
 *           the users table.
 */
export function extractMentions(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    if (m[1]) found.add(m[1].toLowerCase());
  }
  return [...found];
}

/**
 * Re-derive a post's hashtag links from its current body.
 *
 * Called on both create and edit, so it clears the existing links first and
 * rebuilds from scratch. That way removing a #tag from an edited post actually
 * unlinks it, instead of leaving the old link behind.
 *
 * @param body  The post text, or null for a deleted post (links just get cleared).
 */
export async function syncPostTags(postId: string, body: string | null): Promise<void> {
  await db.delete(postTags).where(eq(postTags.postId, postId));
  if (!body) return;

  const names = extractHashtags(body);
  if (names.length === 0) return;

  // Tags are shared across posts, so make sure each name exists before linking.
  // onConflictDoNothing means concurrent posts using the same tag don't collide.
  await db
    .insert(tags)
    .values(names.map((name) => ({ name })))
    .onConflictDoNothing();

  // Read the ids back rather than relying on the insert above returning them:
  // the rows we want may have already existed and been skipped by the conflict.
  const rows = await db.select({ id: tags.id }).from(tags).where(inArray(tags.name, names));
  if (rows.length === 0) return;

  await db
    .insert(postTags)
    .values(rows.map((r) => ({ postId, tagId: r.id })))
    .onConflictDoNothing();
}

/**
 * Notify everyone a post @mentions, except the author.
 *
 * A handle that doesn't match a real user is silently dropped (the inArray
 * lookup just won't find it), so typos and @nonsense cost nothing.
 *
 * @param actorId  The author, skipped so you can't notify yourself by name.
 */
export async function notifyMentions(
  body: string | null,
  actorId: string,
  postId: string,
): Promise<void> {
  if (!body) return;
  const handles = extractMentions(body);
  if (handles.length === 0) return;

  const mentioned = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.username, handles));

  for (const u of mentioned) {
    if (u.id === actorId) continue;
    await createNotification({ userId: u.id, type: 'mention', actorId, postId });
  }
}

/**
 * Insert one notification row.
 *
 * The single choke point for everything that creates a notification (likes,
 * reposts, follows, mentions), so the self-notify guard below only has to live
 * in one place.
 *
 * @param userId   Who receives the notification.
 * @param actorId  Who triggered it.
 */
export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  actorId: string;
  postId?: string | null;
}): Promise<void> {
  // Nobody wants a ping for liking their own post or following nobody-but-self.
  if (params.userId === params.actorId) return;
  await db.insert(notifications).values({
    userId: params.userId,
    type: params.type,
    actorId: params.actorId,
    postId: params.postId ?? null,
  });
}

/**
 * Record an anonymous view tick. No user id, no IP, no session, by design:
 * a view is a count, not a person, so there's nothing here to tie back to who
 * looked. The optional referrer tells us how they got here, nothing about them.
 */
export async function recordView(postId: string, referrer: ViewReferrer | null): Promise<void> {
  await db.insert(postViews).values({ postId, referrer });
}
