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

const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;
const MENTION_RE = /@([a-z0-9_]+)/gi;

export function extractHashtags(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(HASHTAG_RE)) {
    if (m[1]) found.add(m[1].toLowerCase());
  }
  return [...found];
}

export function extractMentions(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    if (m[1]) found.add(m[1].toLowerCase());
  }
  return [...found];
}

/** Extract hashtags from a body and (re)link them to a post. */
export async function syncPostTags(postId: string, body: string | null): Promise<void> {
  await db.delete(postTags).where(eq(postTags.postId, postId));
  if (!body) return;

  const names = extractHashtags(body);
  if (names.length === 0) return;

  await db
    .insert(tags)
    .values(names.map((name) => ({ name })))
    .onConflictDoNothing();

  const rows = await db.select({ id: tags.id }).from(tags).where(inArray(tags.name, names));
  if (rows.length === 0) return;

  await db
    .insert(postTags)
    .values(rows.map((r) => ({ postId, tagId: r.id })))
    .onConflictDoNothing();
}

/** Create mention notifications for @handles found in a post body. */
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

export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  actorId: string;
  postId?: string | null;
}): Promise<void> {
  // Never notify yourself about your own action.
  if (params.userId === params.actorId) return;
  await db.insert(notifications).values({
    userId: params.userId,
    type: params.type,
    actorId: params.actorId,
    postId: params.postId ?? null,
  });
}

/**
 * Record an anonymous view tick. No user id, no IP, no session — by design.
 * A view is a count, not a person.
 */
export async function recordView(postId: string, referrer: ViewReferrer | null): Promise<void> {
  await db.insert(postViews).values({ postId, referrer });
}
