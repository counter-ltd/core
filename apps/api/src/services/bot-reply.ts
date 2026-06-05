// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * On-Counter bot replies.
 *
 * When a post or reply @mentions a server-designated bot account (a user with a
 * non-null `botKind`), the bot answers with a threaded reply, authored by the
 * bot account itself. This is how Thing One lives on Counter, mirroring how
 * Thing Two answers @mentions on Discord.
 *
 * Two things keep it safe. Only the server can mark an account as a bot (the
 * `botKind` column is never writable through the API), so a client cannot turn
 * an account into an auto-replying bot. And a post authored by a bot never
 * triggers more bot replies, so two bots tagging each other cannot loop.
 *
 * Reuses the same Vertex AI path as the Discord /ask command; the persona is
 * loaded from split secrets so the lore stays out of the repo.
 */

import {
  db,
  createDb,
  runWithDb,
  posts,
  users,
  botCooldowns,
  eq,
  and,
  inArray,
  isNotNull,
  sql,
} from '@counter/db';
import { POST, BOT } from '@counter/config';
import { getGoogleAccessToken } from './google-auth.ts';
import { syncPostTags, notifyMentions, extractMentions, createNotification } from './content.ts';

/** How far up the reply chain to read for context, and the per-message cap. */
const MAX_ANCESTORS = 4;
const MAX_ANCESTOR_CHARS = 320;

/** Env the bot-reply path needs: the chat endpoint plus each bot's prompt secrets. */
export interface BotReplyEnv {
  OPENAI_BASE_URL: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  GOOGLE_SA_CLIENT_EMAIL: string;
  GOOGLE_SA_PRIVATE_KEY: string;
  THING_ONE_SYSTEM_PROMPT: string;
  THING_ONE_SYSTEM_PROMPT_2: string;
}

/** The post that did the mentioning, trimmed to what the reply path needs. */
export interface MentioningPost {
  id: string;
  body: string;
  parentId: string | null;
  userId: string;
}

/**
 * Map a bot account's `botKind` to its system prompt, rejoining the split
 * secrets. Returns an empty string for an unknown kind or an unconfigured
 * prompt, which the caller treats as "skip this bot".
 *
 * @param kind  The account's botKind value.
 * @param env   Prompt secrets.
 */
function promptForBot(kind: string, env: BotReplyEnv): string {
  if (kind === 'thing_one') return env.THING_ONE_SYSTEM_PROMPT + env.THING_ONE_SYSTEM_PROMPT_2;
  return '';
}

/**
 * Reply to any bot accounts a freshly created post mentions.
 *
 * Run this from a route via `c.executionCtx.waitUntil(...)` so the model call
 * never delays the poster's response. Failures are swallowed per bot: a stuck
 * model or a bad reply should not surface to whoever wrote the post.
 *
 * Because this runs after the HTTP response, the request's own DB connection is
 * already being drained by the Worker entry, and the model call adds seconds on
 * top. So it opens its own connection (and AsyncLocalStorage scope) for the whole
 * job and closes it at the end. Without this, every query after the model call
 * would hit a closed connection and the reply would silently never post.
 *
 * @param post              The just-created post or reply.
 * @param env               Chat endpoint config plus the bots' prompt secrets.
 * @param connectionString  Hyperdrive/DATABASE_URL string from `c.env`.
 */
export async function handleBotMentions(
  post: MentioningPost,
  env: BotReplyEnv,
  connectionString: string | undefined,
): Promise<void> {
  if (!post.body || !env.OPENAI_BASE_URL || !connectionString) return;

  const instance = createDb(connectionString);
  try {
    await runWithDb(instance, () => replyToMentions(post, env));
  } finally {
    // Drain our own pool once the whole job (model call included) is done.
    await instance.sql.end();
  }
}

/**
 * The actual mention-reply work, run inside a dedicated DB connection scope by
 * {@link handleBotMentions}. Uses the `db` proxy, which resolves to that scope's
 * connection.
 *
 * @param post  The just-created post or reply.
 * @param env   Chat endpoint config plus the bots' prompt secrets.
 */
async function replyToMentions(post: MentioningPost, env: BotReplyEnv): Promise<void> {
  // Loop guard: a post written by a bot never triggers more bot replies, so two
  // bots that mention each other cannot ping-pong forever.
  const author = await db.query.users.findFirst({
    where: eq(users.id, post.userId),
    columns: { username: true, botKind: true },
  });
  if (!author || author.botKind) return;

  const handles = extractMentions(post.body);
  if (handles.length === 0) return;

  // Only accounts the server flagged as bots reply. Everyone else just gets the
  // normal mention notification handled elsewhere.
  const bots = await db
    .select({ id: users.id, username: users.username, botKind: users.botKind })
    .from(users)
    .where(and(inArray(users.username, handles), isNotNull(users.botKind)));

  if (bots.length === 0) return;

  // Limited slice of the thread leading to the mention, so the bot is informed
  // (it can see what it is being dragged into) without us shipping the whole
  // thread every time. Loaded once and reused for every bot in this post.
  const ancestors = await loadAncestorChain(post.parentId);

  for (const bot of bots) {
    // A bot does not answer itself if it somehow ends up in its own mentions.
    if (bot.id === post.userId || !bot.botKind) continue;

    const system = promptForBot(bot.botKind, env);
    if (!system) continue;

    // Per-(user, bot) cooldown: skip if this user got a reply from this bot too
    // recently, and otherwise stamp the cooldown NOW, before the slow model call,
    // so a rapid burst of mentions can't each slip through the window.
    if (!(await claimCooldown(post.userId, bot.id))) continue;

    try {
      const context = buildContext(author.username ?? 'someone', post.body, ancestors);
      const reply = await chat(env, system, context);
      if (!reply) continue;
      await postReply(bot.id, post, reply);
    } catch (err) {
      // Log and move on; one bot failing should not block the others.
      console.error(`bot reply failed for ${bot.username}:`, err);
    }
  }
}

/**
 * Check and claim the cooldown for one (user, bot) pair in a single step.
 *
 * Returns false when the user is still inside the window (skip the reply). When
 * it returns true it has already stamped `lastRepliedAt` to now, so a second
 * mention arriving moments later sees the fresh timestamp and is turned away.
 * The mark happens before the model call deliberately, to close that race.
 *
 * @param userId  The person who mentioned the bot.
 * @param botId   The bot account.
 */
async function claimCooldown(userId: string, botId: string): Promise<boolean> {
  const existing = await db.query.botCooldowns.findFirst({
    where: and(eq(botCooldowns.userId, userId), eq(botCooldowns.botId, botId)),
  });

  const windowMs = BOT.MENTION_COOLDOWN_SECONDS * 1000;
  if (existing && Date.now() - existing.lastRepliedAt.getTime() < windowMs) {
    return false;
  }

  const now = new Date();
  await db
    .insert(botCooldowns)
    .values({ userId, botId, lastRepliedAt: now })
    .onConflictDoUpdate({
      target: [botCooldowns.userId, botCooldowns.botId],
      set: { lastRepliedAt: now },
    });
  return true;
}

/** One post in the thread above the mention, trimmed for the model. */
interface AncestorPost {
  authorName: string;
  body: string;
}

/**
 * Load up to MAX_ANCESTORS posts above the mention for context, each truncated to
 * MAX_ANCESTOR_CHARS to keep the prompt cheap.
 *
 * One recursive CTE walks the parent chain and joins each post's author in a
 * single round-trip, rather than a query per level plus a lookup per author.
 * Deleted posts are excluded and stop the walk. Rows come back oldest-first
 * (highest depth) so the model reads the thread in order; a top-level post (no
 * parent) yields an empty array.
 *
 * @param parentId  The mentioning post's parent, or null.
 */
async function loadAncestorChain(parentId: string | null): Promise<AncestorPost[]> {
  if (!parentId) return [];

  const rows = (await db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT p.id, p.body, p.parent_id, p.user_id, 1 AS depth
      FROM ${posts} p
      WHERE p.id = ${parentId} AND p.deleted = false
      UNION ALL
      SELECT p.id, p.body, p.parent_id, p.user_id, c.depth + 1
      FROM ${posts} p
      JOIN chain c ON p.id = c.parent_id
      WHERE c.depth < ${MAX_ANCESTORS} AND p.deleted = false
    )
    SELECT chain.body AS body, u.username AS username
    FROM chain
    JOIN ${users} u ON u.id = chain.user_id
    ORDER BY chain.depth DESC
  `)) as unknown as Array<{ body: string | null; username: string | null }>;

  return rows
    .filter((r) => r.body)
    .map((r) => ({
      authorName: r.username ?? 'someone',
      body: (r.body as string).slice(0, MAX_ANCESTOR_CHARS),
    }));
}

/**
 * Build the single user turn handed to the model: the thread context (when the
 * mention is a reply) followed by the mention itself.
 *
 * @param authorName  Handle of the person who mentioned the bot.
 * @param body        The mentioning post's text.
 * @param ancestors   Oldest-first slice of the thread above the mention.
 */
function buildContext(authorName: string, body: string, ancestors: AncestorPost[]): string {
  let lead = '';
  if (ancestors.length > 0) {
    lead = 'Thread so far (oldest first):\n';
    for (const a of ancestors) lead += `@${a.authorName}: "${a.body}"\n`;
    lead += '\n';
  }
  return `${lead}@${authorName} mentioned you in a post: "${body}"\n\nReply to them.`;
}

/**
 * Insert the bot's reply, threaded under the mentioning post, and wire up tags,
 * mention notifications, and a reply notification to the person it answered.
 *
 * @param botId  The bot account authoring the reply.
 * @param post   The post that mentioned the bot.
 * @param body   The reply text.
 */
async function postReply(botId: string, post: MentioningPost, body: string): Promise<void> {
  const [created] = await db
    .insert(posts)
    .values({ userId: botId, body, parentId: post.id })
    .returning();
  if (!created) return;

  await syncPostTags(created.id, body);
  await notifyMentions(body, botId, created.id);
  // Tell the person the bot answered, the same way a human reply would.
  await createNotification({ userId: post.userId, type: 'reply', actorId: botId, postId: created.id });
}

/**
 * Send one prompt to the Vertex AI OpenAI-compatible endpoint and return the
 * reply, trimmed to Counter's post length limit. Authenticates with a minted
 * Google token when a service account is set, otherwise a static key.
 *
 * @param env     Chat endpoint config.
 * @param system  The bot's system prompt.
 * @param content The user turn (mention plus context).
 */
async function chat(env: BotReplyEnv, system: string, content: string): Promise<string> {
  const base = env.OPENAI_BASE_URL.replace(/\/+$/, '');
  const bearer =
    env.GOOGLE_SA_PRIVATE_KEY && env.GOOGLE_SA_CLIENT_EMAIL
      ? await getGoogleAccessToken({
          clientEmail: env.GOOGLE_SA_CLIENT_EMAIL,
          privateKey: env.GOOGLE_SA_PRIVATE_KEY,
        })
      : env.OPENAI_API_KEY;

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) throw new Error(`Vertex returned ${res.status}`);

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  return text ? text.slice(0, POST.MAX_BODY_LENGTH) : '';
}
