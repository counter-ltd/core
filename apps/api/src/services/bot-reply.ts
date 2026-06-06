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
  eq,
  and,
  inArray,
  isNotNull,
  sql,
} from '@counter/db';
import { POST } from '@counter/config';
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
  // Loop guard: a post written by a bot never triggers more bot replies, so a
  // bot answering in a thread can't set off an endless back-and-forth.
  const author = await db.query.users.findFirst({
    where: eq(users.id, post.userId),
    columns: { username: true, botKind: true },
  });
  if (!author || author.botKind) return;

  // Walk the thread above this post once. It serves two jobs: finding the bots
  // already in the conversation, and the text context to feed them.
  const thread = await loadThread(post.parentId);

  // Bots that should answer: ones tagged in this post, plus ones already taking
  // part in this thread. A bot in the thread replies to new posts even when it
  // is not re-tagged, the way a person in a conversation keeps talking.
  const candidates = new Map<string, BotRef>();
  for (const b of await mentionedBots(post.body)) candidates.set(b.id, b);
  for (const t of thread) {
    if (t.botKind) candidates.set(t.userId, { id: t.userId, username: t.username, botKind: t.botKind });
  }
  candidates.delete(post.userId); // never the author of this post
  if (candidates.size === 0) return;

  // Nearest few thread posts as context, oldest-first, capped for token cost.
  const context = thread
    .slice(0, MAX_ANCESTORS)
    .reverse()
    .filter((t) => t.body)
    .map((t) => ({ authorName: t.username, body: t.body.slice(0, MAX_ANCESTOR_CHARS) }));

  for (const bot of candidates.values()) {
    const system = promptForBot(bot.botKind, env);
    if (!system) continue;

    // Per-reply guard: never answer the same post twice. Replaces a per-user
    // time cooldown, which would have muted the bot mid-conversation.
    if (await alreadyReplied(bot.id, post.id)) continue;

    try {
      const prompt = buildContext(author.username ?? 'someone', post.body, context);
      const reply = await chat(env, system, prompt);
      if (!reply) continue;
      await postReply(bot.id, post, reply);
    } catch (err) {
      // Log and move on; one bot failing should not block the others.
      console.error(`bot reply failed for ${bot.username}:`, err);
    }
  }
}

/** A bot account in the running: its id, handle, and persona key. */
interface BotRef {
  id: string;
  username: string;
  botKind: string;
}

/**
 * Resolve the @mentioned handles in a body to the bot accounts among them.
 *
 * @param body  The post text.
 */
async function mentionedBots(body: string): Promise<BotRef[]> {
  const handles = extractMentions(body);
  if (handles.length === 0) return [];
  const rows = await db
    .select({ id: users.id, username: users.username, botKind: users.botKind })
    .from(users)
    .where(and(inArray(users.username, handles), isNotNull(users.botKind)));
  return rows.filter((r): r is BotRef => Boolean(r.botKind));
}

/**
 * Has this bot already replied to this exact post? The per-reply guard, so a
 * reprocessed or edited post can't draw a second reply from the same bot.
 *
 * @param botId   The bot account.
 * @param postId  The post the bot might reply to.
 */
async function alreadyReplied(botId: string, postId: string): Promise<boolean> {
  const dup = await db.query.posts.findFirst({
    where: and(eq(posts.userId, botId), eq(posts.parentId, postId), eq(posts.deleted, false)),
    columns: { id: true },
  });
  return Boolean(dup);
}

/** One post in the thread above the new post. */
interface ThreadPost {
  userId: string;
  username: string;
  botKind: string | null;
  body: string;
}

/**
 * Walk the parent chain above a post, nearest-first, in one recursive CTE.
 *
 * Returns up to MAX_THREAD_DEPTH posts (capped against a pathological chain),
 * each with its author's handle and botKind so the caller can both build context
 * and spot which bots are already in the thread. Deleted posts are excluded and
 * stop the walk. A top-level post (no parent) yields an empty array.
 *
 * @param parentId  The new post's parent, or null.
 */
async function loadThread(parentId: string | null): Promise<ThreadPost[]> {
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
      WHERE c.depth < 50 AND p.deleted = false
    )
    SELECT chain.user_id AS user_id, chain.body AS body, u.username AS username, u.bot_kind AS bot_kind
    FROM chain
    JOIN ${users} u ON u.id = chain.user_id
    ORDER BY chain.depth ASC
  `)) as unknown as Array<{
    user_id: string;
    body: string | null;
    username: string | null;
    bot_kind: string | null;
  }>;

  return rows.map((r) => ({
    userId: r.user_id,
    username: r.username ?? 'someone',
    botKind: r.bot_kind,
    body: r.body ?? '',
  }));
}

/** One thread post as the model sees it for context. */
interface AncestorPost {
  authorName: string;
  body: string;
}

/**
 * Build the single user turn handed to the model: the thread context (when there
 * is one) followed by the post to answer.
 *
 * @param authorName  Handle of the person whose post the bot is answering.
 * @param body        That post's text.
 * @param ancestors   Oldest-first slice of the thread above it.
 */
function buildContext(authorName: string, body: string, ancestors: AncestorPost[]): string {
  let lead = '';
  if (ancestors.length > 0) {
    lead = 'Thread so far (oldest first):\n';
    for (const a of ancestors) lead += `@${a.authorName}: "${a.body}"\n`;
    lead += '\n';
  }
  return `${lead}@${authorName} just posted: "${body}"\n\nReply to them.`;
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
