// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Discord-initiated posting for Thing Two.
 *
 * Handles two interaction types: a /post slash command that publishes the
 * caller's own text, and a "Share to Counter" message context menu command
 * that quotes someone else's Discord message with attribution. Both create
 * real Counter posts on behalf of the linked, opted-in user.
 *
 * Attribution links the original Discord author's Counter profile when their
 * Discord account is connected; otherwise it falls back to their Discord
 * username. The bot never posts without an explicit opt-in (postingEnabled).
 *
 * Also hosts the /interact slash command (lightweight fun interactions like
 * coinflip that post a public reply tagging the invoker) and the /ask command
 * (chat with the bot through an OpenAI-compatible endpoint, answered via a
 * deferred followup). Neither needs a Counter account, link, or opt-in since
 * they never write to Counter.
 */

import { db, posts, oauthAccounts, discordBotSubscriptions, users, eq, and } from '@counter/db';
import { POST } from '@counter/config';
import type { DiscordShareMeta } from '@counter/types';
import { syncPostTags, notifyMentions } from './content.ts';
import { syncDiscordAvatar } from './discord-avatar.ts';
import { getGoogleAccessToken } from './google-auth.ts';

const DISCORD_API = 'https://discord.com/api/v10';

// --- Discord interaction types ---

/** Subset of a Discord interaction payload we care about. */
export interface DiscordInteraction {
  type: number;
  // Opaque token used to edit/followup a deferred response. Valid for 15 minutes.
  token?: string;
  data?: {
    name: string;
    type?: number;
    // For chat-input commands these are the option values. For commands with
    // subcommands, the single entry is the chosen subcommand (its own `options`
    // hold that subcommand's arguments).
    options?: Array<{ name: string; value?: string; type?: number; options?: Array<{ name: string; value: string }> }>;
    target_id?: string;
    resolved?: {
      messages?: Record<string, DiscordMessage>;
    };
  };
  // Present in guild contexts; absent in DM interactions.
  member?: { user: DiscordUser };
  // Present in DM interactions.
  user?: DiscordUser;
}

/** Minimal Discord user shape from interaction payloads. */
export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  // "0" on accounts that migrated to the new username system; omit the tag in that case.
  discriminator?: string | null;
  // Avatar hash for building the CDN URL. Null/absent means a default avatar.
  avatar?: string | null;
}

/** Minimal Discord message shape from resolved interaction data. */
interface DiscordMessage {
  content: string;
  author: DiscordUser;
}

// --- Signature verification ---

/** Convert a hex string to a Uint8Array for WebCrypto. */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Verify an incoming Discord interaction signature using Ed25519.
 *
 * Discord signs every interaction request with the app's public key. We must
 * reject unsigned or tampered requests before trusting any payload contents.
 * Discord returns 401 to the bot if we fail to respond to valid pings, so this
 * runs even on PING (type 1) interactions.
 *
 * @param publicKeyHex  Hex-encoded Ed25519 public key from the Discord app dashboard.
 * @param signature     `X-Signature-Ed25519` header value.
 * @param timestamp     `X-Signature-Timestamp` header value.
 * @param rawBody       Raw request body string (must not be parsed before this runs).
 */
export async function verifyDiscordSignature(
  publicKeyHex: string,
  signature: string,
  timestamp: string,
  rawBody: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(publicKeyHex),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + rawBody),
    );
  } catch {
    // importKey or verify threw (malformed hex, wrong key length, etc.).
    return false;
  }
}

// --- User lookup helpers ---

/**
 * Find the Counter user linked to a Discord snowflake ID.
 *
 * @returns The Counter user ID, or null if no account is linked.
 */
async function counterUserForDiscordId(discordUserId: string): Promise<string | null> {
  const row = await db.query.oauthAccounts.findFirst({
    where: and(eq(oauthAccounts.provider, 'discord'), eq(oauthAccounts.providerUserId, discordUserId)),
  });
  return row?.userId ?? null;
}

/**
 * Check whether the user has opted in to Discord-initiated posting.
 *
 * @returns True when postingEnabled is set on their subscription row.
 */
async function postingAllowed(userId: string): Promise<boolean> {
  const row = await db.query.discordBotSubscriptions.findFirst({
    where: eq(discordBotSubscriptions.userId, userId),
  });
  return row?.postingEnabled ?? false;
}

// --- Post creation ---

/**
 * Create a Counter post on behalf of a user, wiring up tags and mention
 * notifications exactly as the HTTP handler does.
 *
 * @param userId      Counter user ID of the post author.
 * @param body        Post text; caller is responsible for length validation.
 * @param sourceMeta  Optional rich card metadata stored alongside the body.
 * @returns The newly created post ID.
 */
async function createPost(
  userId: string,
  body: string,
  sourceMeta?: DiscordShareMeta,
): Promise<string> {
  const [created] = await db
    .insert(posts)
    .values({ userId, body, sourceMeta: sourceMeta ?? null })
    .returning();
  if (!created) throw new Error('Post insert returned no row');

  await syncPostTags(created.id, body);
  await notifyMentions(body, userId, created.id);

  return created.id;
}

// --- Attribution formatting ---

/** Result of resolving a Discord message author against Counter's user table. */
interface AttributionResult {
  /** Plain-text attribution line used as the post body fallback. */
  text: string;
  /** Discord display name shown in the card (global_name or username). */
  authorName: string;
  /** Discriminator tag ("1234"), or null for new-style Discord accounts. */
  authorDiscordTag: string | null;
  /** Counter username when the author has a linked account, otherwise null. */
  authorCounterUsername: string | null;
}

/**
 * Resolve the attribution for a shared Discord message.
 *
 * Prefers a Counter @handle when the Discord author has a linked account;
 * falls back to their Discord display name with "on Discord".
 *
 * @param discordAuthor  Discord user object from the resolved message.
 */
async function buildAttribution(discordAuthor: DiscordUser): Promise<AttributionResult> {
  const displayName = discordAuthor.global_name || discordAuthor.username;
  // Discriminator "0" means the account migrated to the new username system, so treat it as absent.
  const tag = discordAuthor.discriminator && discordAuthor.discriminator !== '0'
    ? discordAuthor.discriminator
    : null;

  const counterUserId = await counterUserForDiscordId(discordAuthor.id);
  if (counterUserId) {
    const user = await db.query.users.findFirst({ where: eq(users.id, counterUserId) });
    if (user) {
      const handle = tag ? `${displayName}#${tag}` : displayName;
      return {
        text: `${handle} (@${user.username})`,
        authorName: displayName,
        authorDiscordTag: tag,
        authorCounterUsername: user.username,
      };
    }
  }

  const handle = tag ? `${displayName}#${tag}` : displayName;
  return {
    text: `${handle} on Discord`,
    authorName: displayName,
    authorDiscordTag: tag,
    authorCounterUsername: null,
  };
}

// --- Exported interaction handlers ---

/** Ephemeral Discord response flags. Only the command sender sees ephemeral replies. */
const EPHEMERAL = 64;

/** Discord interaction response type: immediate message reply. */
const CHANNEL_MESSAGE = 4;

/**
 * Handle a /post slash command: publish the text option as a Counter post.
 *
 * Responds ephemerally so the post confirmation is only visible to the sender.
 *
 * @param interaction  Parsed Discord interaction payload.
 * @returns Discord interaction response object.
 */
export async function handlePostCommand(
  interaction: DiscordInteraction,
): Promise<Record<string, unknown>> {
  const discordUser = interaction.member?.user ?? interaction.user;
  if (!discordUser) {
    return ephemeralReply('Could not identify your Discord account.');
  }

  const userId = await counterUserForDiscordId(discordUser.id);
  if (!userId) {
    return ephemeralReply(
      'Link your Discord account to Counter first at counter.ltd/settings.',
    );
  }

  if (!(await postingAllowed(userId))) {
    return ephemeralReply(
      'Enable Discord posting in Counter Settings > Thing Two first.',
    );
  }

  const content = interaction.data?.options?.find((o) => o.name === 'content')?.value ?? '';
  if (!content.trim()) {
    return ephemeralReply('Post content cannot be empty.');
  }

  // Truncate rather than reject, so long Discord messages still work.
  const body = content.slice(0, POST.MAX_BODY_LENGTH);

  await createPost(userId, body);

  return ephemeralReply('Posted to Counter.');
}

/**
 * Handle a "Share to Counter" message context menu command.
 *
 * Formats the target Discord message as a quoted post with attribution and
 * creates it on behalf of the command invoker. If the original author's Discord
 * account is linked to Counter, their Counter handle appears in the attribution.
 *
 * @param interaction  Parsed Discord interaction payload.
 * @returns Discord interaction response object.
 */
export async function handleShareCommand(
  interaction: DiscordInteraction,
): Promise<Record<string, unknown>> {
  const discordUser = interaction.member?.user ?? interaction.user;
  if (!discordUser) {
    return ephemeralReply('Could not identify your Discord account.');
  }

  const userId = await counterUserForDiscordId(discordUser.id);
  if (!userId) {
    return ephemeralReply(
      'Link your Discord account to Counter first at counter.ltd/settings.',
    );
  }

  if (!(await postingAllowed(userId))) {
    return ephemeralReply(
      'Enable Discord posting in Counter Settings > Thing Two first.',
    );
  }

  const targetId = interaction.data?.target_id;
  const targetMessage = targetId
    ? interaction.data?.resolved?.messages?.[targetId]
    : undefined;

  if (!targetMessage?.content) {
    return ephemeralReply('That message has no text content to share.');
  }

  const attribution = await buildAttribution(targetMessage.author);
  // Pull the author's Discord avatar into our own storage so the shared card
  // shows their pfp (the whole point of the screenshot ask), deduped and cached.
  const authorAvatarUrl = await syncDiscordAvatar(targetMessage.author);

  // Keep the quoted content within limits, leaving room for the attribution line.
  const maxQuote = POST.MAX_BODY_LENGTH - attribution.text.length - 5;
  const quote = targetMessage.content.slice(0, maxQuote);

  // Body is the plain-text fallback for clients that don't render the card.
  const body = `"${quote}"\n\n— ${attribution.text}`;

  const sourceMeta: DiscordShareMeta = {
    type: 'discord_share',
    content: targetMessage.content,
    authorName: attribution.authorName,
    authorDiscordTag: attribution.authorDiscordTag,
    authorDiscordId: targetMessage.author.id,
    authorCounterUsername: attribution.authorCounterUsername,
    authorAvatarUrl,
  };

  await createPost(userId, body, sourceMeta);

  return ephemeralReply('Shared to Counter.');
}

/**
 * Build an ephemeral Discord interaction response with plain text.
 *
 * @param content  The message text shown only to the command invoker.
 */
function ephemeralReply(content: string): Record<string, unknown> {
  return {
    type: CHANNEL_MESSAGE,
    data: { content, flags: EPHEMERAL },
  };
}

/**
 * Build a public Discord interaction response with plain text. Unlike
 * {@link ephemeralReply}, everyone in the channel sees this.
 *
 * @param content  The message text shown to the whole channel.
 */
function publicReply(content: string): Record<string, unknown> {
  return {
    type: CHANNEL_MESSAGE,
    data: { content },
  };
}

/**
 * Handle the /interact slash command. Routes on the chosen subcommand; the
 * subcommand is required, so Discord won't dispatch a bare /interact.
 *
 * No Counter account or opt-in is needed. These are lightweight fun
 * interactions that post a public message tagging the invoker.
 *
 * @param interaction  Parsed Discord interaction payload.
 * @returns Discord interaction response object.
 */
export async function handleInteractCommand(
  interaction: DiscordInteraction,
): Promise<Record<string, unknown>> {
  const discordUser = interaction.member?.user ?? interaction.user;
  if (!discordUser) {
    return ephemeralReply('Could not identify your Discord account.');
  }

  // With a required subcommand, options[0] is the subcommand Discord matched.
  const sub = interaction.data?.options?.[0];
  // <@id> renders as a mention; works whether or not we know the display name.
  const mention = `<@${discordUser.id}>`;

  if (sub?.name === 'coinflip') {
    const side = coinSide();
    return publicReply(`${mention} flipped a coin: **${side}**`);
  }

  if (sub?.name === 'dice') {
    // `sides` is optional; default to a standard six-sided die.
    const raw = subOption(sub, 'sides');
    const sides = clampSides(typeof raw === 'number' ? raw : Number(raw));
    const roll = randomInt(sides) + 1;
    return publicReply(`${mention} rolled a ${sides}-sided die: **${roll}**`);
  }

  if (sub?.name === '8ball') {
    const question = String(subOption(sub, 'question') ?? '').trim();
    if (!question) {
      return ephemeralReply('Ask the magic 8-ball a question.');
    }
    const answer = EIGHT_BALL_ANSWERS[randomInt(EIGHT_BALL_ANSWERS.length)]!;
    return publicReply(`${mention} asked: ${question}\n🎱 **${answer}**`);
  }

  return ephemeralReply('Unknown interaction.');
}

/**
 * Read a named argument off a chosen subcommand.
 *
 * @param sub   The subcommand entry (interaction.data.options[0]).
 * @param name  The argument name to look up.
 * @returns The raw option value, or undefined when absent.
 */
function subOption(
  sub: { options?: Array<{ name: string; value: string }> },
  name: string,
): string | number | undefined {
  return sub.options?.find((o) => o.name === name)?.value;
}

/** Keep dice within sane bounds: at least a coin's two faces, at most 1000. */
function clampSides(n: number): number {
  if (!Number.isFinite(n)) return 6;
  return Math.min(1000, Math.max(2, Math.floor(n)));
}

/**
 * Flip a fair coin. Uses WebCrypto rather than Math.random so it runs the same
 * on Workers and Bun, matching the auth code's crypto-only rule.
 *
 * @returns "heads" or "tails", each with even odds.
 */
function coinSide(): 'heads' | 'tails' {
  // Low bit of one random byte is an unbiased fair flip.
  return crypto.getRandomValues(new Uint8Array(1))[0]! & 1 ? 'heads' : 'tails';
}

/**
 * Uniform random integer in [0, max) using WebCrypto with rejection sampling.
 *
 * A plain `random % max` is biased when max doesn't divide 256 evenly, so we
 * discard bytes in the unfair tail and redraw. max is small here (<= 1000) so
 * we draw two bytes and reject from a 16-bit space.
 *
 * @param max  Exclusive upper bound; must be >= 1.
 */
function randomInt(max: number): number {
  // Largest multiple of max that fits in 16 bits; anything above biases the result.
  const limit = Math.floor(65536 / max) * max;
  const buf = new Uint8Array(2);
  for (;;) {
    crypto.getRandomValues(buf);
    const n = (buf[0]! << 8) | buf[1]!;
    if (n < limit) return n % max;
  }
}

/** Classic Magic 8-Ball replies: 10 affirmative, 5 non-committal, 5 negative. */
const EIGHT_BALL_ANSWERS = [
  'It is certain.',
  'It is decidedly so.',
  'Without a doubt.',
  'Yes definitely.',
  'You may rely on it.',
  'As I see it, yes.',
  'Most likely.',
  'Outlook good.',
  'Yes.',
  'Signs point to yes.',
  'Reply hazy, try again.',
  'Ask again later.',
  'Better not tell you now.',
  'Cannot predict now.',
  'Concentrate and ask again.',
  "Don't count on it.",
  'My reply is no.',
  'My sources say no.',
  'Outlook not so good.',
  'Very doubtful.',
] as const;

// --- /ask chat command ---

/** Discord response type that defers the reply ("Thing Two is thinking..."). */
const DEFERRED_CHANNEL_MESSAGE = 5;

/** Discord caps a single message at 2000 characters. */
const DISCORD_MESSAGE_LIMIT = 2000;

/** Config the /ask command needs, pulled from the validated server env. */
export interface AskEnv {
  OPENAI_BASE_URL: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  DISCORD_APP_ID: string;
  // When set, authenticate to Vertex AI with a minted token instead of a static
  // key. The private key may carry escaped "\n"; google-auth normalizes it.
  GOOGLE_SA_CLIENT_EMAIL: string;
  GOOGLE_SA_PRIVATE_KEY: string;
  // The persona/lore prompt, loaded from secrets so it stays out of the repo and
  // split across several parts to fit Cloudflare's per-secret size cap. The parts
  // are concatenated at use; all empty falls back to FALLBACK_SYSTEM_PROMPT. The
  // third part is only set when the prompt is long enough to need it.
  THING_TWO_SYSTEM_PROMPT: string;
  THING_TWO_SYSTEM_PROMPT_2: string;
  THING_TWO_SYSTEM_PROMPT_3?: string;
}

/**
 * Resolve the bearer token for the chat call: a minted Google access token when
 * a service account is configured, otherwise the static OPENAI_API_KEY.
 *
 * @param env  The /ask config.
 * @returns The bearer credential string.
 */
async function resolveBearer(env: AskEnv): Promise<string> {
  if (env.GOOGLE_SA_PRIVATE_KEY && env.GOOGLE_SA_CLIENT_EMAIL) {
    return getGoogleAccessToken({
      clientEmail: env.GOOGLE_SA_CLIENT_EMAIL,
      privateKey: env.GOOGLE_SA_PRIVATE_KEY,
    });
  }
  return env.OPENAI_API_KEY;
}

/** True when /ask has enough config to make a call (a base URL plus some auth). */
function askConfigured(env: AskEnv): boolean {
  if (!env.OPENAI_BASE_URL) return false;
  const hasGoogle = Boolean(env.GOOGLE_SA_PRIVATE_KEY && env.GOOGLE_SA_CLIENT_EMAIL);
  return hasGoogle || Boolean(env.OPENAI_API_KEY);
}

/**
 * Handle the /ask slash command: send the prompt to an OpenAI-compatible chat
 * endpoint and post the reply publicly.
 *
 * The model call takes longer than Discord's 3-second interaction deadline, so
 * we acknowledge immediately with a deferred response and finish the work in the
 * background via `schedule`. Discord shows a "thinking" state until the followup
 * edits in the real answer.
 *
 * Returns an immediate (non-deferred) ephemeral error when the prompt is empty
 * or chat isn't configured, since there's nothing to wait on in those cases.
 *
 * @param interaction  Parsed Discord interaction payload (must carry `token`).
 * @param env          OpenAI endpoint config plus the Discord app ID.
 * @param schedule     Hook to keep the Worker alive for the background followup
 *                     (pass `c.executionCtx.waitUntil`).
 * @returns The interaction response Discord receives within the 3s window.
 */
export function handleAskCommand(
  interaction: DiscordInteraction,
  env: AskEnv,
  schedule: (p: Promise<unknown>) => void,
): Record<string, unknown> {
  const prompt = String(
    interaction.data?.options?.find((o) => o.name === 'prompt')?.value ?? '',
  ).trim();

  if (!prompt) {
    return ephemeralReply('Ask me something: /ask <prompt>.');
  }

  if (!askConfigured(env)) {
    return ephemeralReply('Chat is not configured.');
  }

  if (!interaction.token) {
    return ephemeralReply('Could not start a chat (missing interaction token).');
  }

  // Hand the slow work to the Worker's waitUntil so we can ACK inside 3s.
  schedule(askAndFollowup(interaction.token, prompt, env));

  // type 5 with no flags: a public "thinking" placeholder everyone can see.
  return { type: DEFERRED_CHANNEL_MESSAGE };
}

/**
 * Bland stand-in used only when THING_TWO_SYSTEM_PROMPT is not set. The real
 * persona and lore are private (loaded from a secret, never in the repo), so the
 * fallback is deliberately characterless: /ask still answers, just without the
 * voice. Set the secret with scripts/deploy-ask-prompt.sh to get the real one.
 */
const FALLBACK_SYSTEM_PROMPT =
  'You are Thing Two, a Discord bot for Counter. Be helpful and concise.';

/**
 * Call the model, then edit the deferred response with its answer.
 *
 * Any failure (network, non-2xx, empty completion) still posts a followup so the
 * "thinking" placeholder never hangs forever.
 *
 * @param token   Interaction token for the followup edit.
 * @param prompt  The user's question.
 * @param env     OpenAI endpoint config plus the Discord app ID.
 */
async function askAndFollowup(token: string, prompt: string, env: AskEnv): Promise<void> {
  let answer: string;
  try {
    answer = await callChatModel(env, prompt);
  } catch {
    answer = 'Something went wrong reaching the model. Try again in a bit.';
  }
  await editOriginalResponse(env.DISCORD_APP_ID, token, withQuestion(prompt, answer));
}

/**
 * Prepend the asked question as a Discord blockquote above the answer, so the
 * reply stands on its own without scrolling up to the slash-command header.
 *
 * Newlines in the question collapse to spaces to keep it a single quoted line,
 * and the whole thing is trimmed to Discord's message limit (answer first, so a
 * very long question can't crowd out the reply).
 *
 * @param question  The user's prompt.
 * @param answer    The model's reply.
 */
function withQuestion(question: string, answer: string): string {
  const quoted = `> ${question.replace(/\s*\n\s*/g, ' ')}`;
  // Cap the quoted question so the answer always keeps most of the budget.
  const header = quoted.slice(0, 300);
  return `${header}\n\n${answer}`.slice(0, DISCORD_MESSAGE_LIMIT);
}

/** Minimal shape of an OpenAI chat-completions response. */
interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Send a single-turn prompt to an OpenAI-compatible chat-completions endpoint.
 *
 * OPENAI_BASE_URL is the API root (e.g. https://api.openai.com/v1); we append
 * `/chat/completions`. The 25s timeout stays under Discord's 15-minute followup
 * window while not hanging the Worker forever on a stalled provider.
 *
 * @param env     OpenAI endpoint config.
 * @param prompt  The user's question.
 * @returns The model's reply text, trimmed to Discord's message limit.
 */
async function callChatModel(env: AskEnv, prompt: string): Promise<string> {
  // Tolerate a trailing slash on the configured base URL.
  const base = env.OPENAI_BASE_URL.replace(/\/+$/, '');
  const bearer = await resolveBearer(env);

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          // Rejoin the secret parts; fall back when none is configured. Each part
          // may be missing, so coalesce before concatenating to avoid "undefined".
          content:
            (env.THING_TWO_SYSTEM_PROMPT ?? '') +
              (env.THING_TWO_SYSTEM_PROMPT_2 ?? '') +
              (env.THING_TWO_SYSTEM_PROMPT_3 ?? '') || FALLBACK_SYSTEM_PROMPT,
        },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) {
    throw new Error(`Chat endpoint returned ${res.status}`);
  }

  const data = (await res.json()) as ChatCompletion;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return 'The model returned an empty reply.';
  }

  return content.slice(0, DISCORD_MESSAGE_LIMIT);
}

/**
 * Edit the original deferred interaction response with final content.
 *
 * The interaction token is its own authorization, so no bot token is needed on
 * this call. Failures are swallowed: by this point the user already saw the
 * "thinking" state, and there's no second chance to recover.
 *
 * @param appId    Discord application ID.
 * @param token    Interaction token from the original payload.
 * @param content  The message text to show.
 */
async function editOriginalResponse(
  appId: string,
  token: string,
  content: string,
): Promise<void> {
  await fetch(`${DISCORD_API}/webhooks/${appId}/${token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

// --- Slash command registration ---

/** Discord application command types. */
const CommandType = {
  CHAT_INPUT: 1,
  MESSAGE: 3,
} as const;

/**
 * Register (or overwrite) the Thing Two slash commands with Discord.
 *
 * Uses a bulk PUT so running this twice is safe: Discord replaces the full
 * command list rather than appending. Run once after deploying a new command.
 *
 * Scope matters for how fast changes show up. Global commands (no guildId) are
 * cached by Discord clients and can take up to an hour to appear. Guild commands
 * (guildId set) update instantly, so pass a guild for dev and quick iteration.
 *
 * @param appId     Discord application ID.
 * @param botToken  Bot token for authentication.
 * @param guildId   Optional guild ID. When set, registers guild-scoped commands
 *                  (instant) instead of global ones.
 */
export async function registerDiscordCommands(
  appId: string,
  botToken: string,
  guildId?: string,
): Promise<void> {
  const commands = [
    {
      name: 'post',
      description: 'Post to your Counter account',
      type: CommandType.CHAT_INPUT,
      options: [
        {
          name: 'content',
          description: 'What to post',
          type: 3, // STRING
          required: true,
        },
      ],
    },
    {
      name: 'interact',
      description: 'Fun interactions',
      type: CommandType.CHAT_INPUT,
      options: [
        {
          // SUB_COMMAND (type 1). Marking it required-by-design: a command
          // whose only options are subcommands can't be invoked bare.
          name: 'coinflip',
          description: 'Flip a coin for heads or tails',
          type: 1,
        },
        {
          name: 'dice',
          description: 'Roll a die',
          type: 1,
          options: [
            {
              name: 'sides',
              description: 'Number of sides (2-1000, default 6)',
              type: 4, // INTEGER
              required: false,
            },
          ],
        },
        {
          name: '8ball',
          description: 'Ask the magic 8-ball a question',
          type: 1,
          options: [
            {
              name: 'question',
              description: 'Your yes/no question',
              type: 3, // STRING
              required: true,
            },
          ],
        },
      ],
    },
    {
      name: 'ask',
      description: 'Ask Thing Two a question',
      type: CommandType.CHAT_INPUT,
      options: [
        {
          name: 'prompt',
          description: 'What do you want to ask?',
          type: 3, // STRING
          required: true,
        },
      ],
    },
    {
      // Message context menu commands have no description.
      name: 'Share to Counter',
      type: CommandType.MESSAGE,
    },
  ];

  const url = guildId
    ? `${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`
    : `${DISCORD_API}/applications/${appId}/commands`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord command registration returned ${res.status}: ${text}`);
  }
}
