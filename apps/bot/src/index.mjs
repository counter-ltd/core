// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Thing Two gateway bot.
 *
 * The Worker API handles slash commands over HTTP, but a plain "@thingtwo hi"
 * is a normal message, and normal messages only arrive over Discord's Gateway:
 * a persistent WebSocket. Workers can't hold one open, so this tiny Node service
 * does. It runs on Cloud Run (always-on, one instance) and answers whenever the
 * bot is @mentioned, using the same Vertex AI model as /ask.
 *
 * It acts on a mention from a human, and also bickers with its sibling bot (the
 * other Thing) when one is configured. On either trigger it pulls the last few
 * messages of that one channel to answer with context, then forgets them. Nothing
 * is stored between mentions and all other traffic is ignored, so the footprint
 * stays flat no matter how large the server grows: work happens only on a
 * trigger. Reading recent history needs the privileged Message Content intent
 * (one toggle in the developer portal).
 *
 * Sibling banter is loop-guarded. Two bots left to reply to each other would
 * ping-pong forever and burn tokens, so a bot only ever engages a known sibling
 * id, chimes in unprompted only some of the time, and goes silent once the
 * channel already has a run of bot messages with no human between them. A human
 * message resets that run. The same code serves any Thing: the persona and bot
 * token come from env (SYSTEM_PROMPT, DISCORD_BOT_TOKEN), so Thing Two and Thing
 * Five are two deploys of this one file.
 *
 * Auth to Vertex is via Application Default Credentials: on Cloud Run the
 * runtime service account is picked up automatically, so there is no key file
 * here. That account needs roles/aiplatform.user.
 */

import http from 'node:http';
import { Client, Events, GatewayIntentBits, Options } from 'discord.js';
import { GoogleAuth } from 'google-auth-library';
import { gifPromptSection, resolveGif } from './gifs.mjs';

// --- config ---

const BOT_TOKEN = requireEnv('DISCORD_BOT_TOKEN');
const PROJECT = requireEnv('GCP_PROJECT');
const LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const MODEL = process.env.VERTEX_MODEL || 'google/gemini-2.5-flash';
// Cloud Run injects PORT and treats the container as unhealthy if nothing
// listens on it. The bot itself serves no HTTP, so this is purely a health pin.
const PORT = Number(process.env.PORT) || 8080;

const VERTEX_BASE = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/endpoints/openapi`;

// Persona. Canonical source is private/thing-personas.mjs (kept out of the repo),
// which scripts/deploy-bot.sh reads and injects as SYSTEM_PROMPT at deploy time,
// so this bot and the /ask command always speak the same way. The fallback below
// is only for a bare local run with no env set; it is not the source of truth.
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  'You are Thing Two, the Discord bot for Counter. Be helpful, concise, and a little playful.';

// Append the gif menu + protocol to the persona, once at boot. This is empty
// when no gifs are configured (see gifs.mjs), so the model only ever hears about
// gifs it can actually post.
const GIF_SECTION = gifPromptSection();
const SYSTEM_PROMPT_WITH_GIFS = GIF_SECTION ? `${SYSTEM_PROMPT}\n\n${GIF_SECTION}` : SYSTEM_PROMPT;

/**
 * Minimum gap between gifs in a single channel. The model is told to use gifs
 * rarely, but models drift, so this is the hard backstop that keeps a gif a
 * punchline instead of wallpaper. Per channel, so a gif in one room doesn't mute
 * another. Defaults to 4 minutes.
 */
const GIF_COOLDOWN_MS = Number(process.env.GIF_COOLDOWN_MS) || 240_000;

// Last time a gif went out per channel id, for the cooldown above. Bounded by the
// number of active channels and swept along with nothing else; it stays tiny.
const lastGifAt = new Map();

/** Discord caps a single message at 2000 characters. */
const DISCORD_MESSAGE_LIMIT = 2000;

// --- scale knobs ---
// These bound the work a single mention can cost, so a massive, busy server
// can't translate into unbounded prompt size, memory, or model load.

/** How many recent messages of the channel to feed the model as context. */
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT) || 12;

/** Per-message character cap in the context, so one wall of text can't dominate. */
const MAX_MSG_CHARS = 600;

/** Max model calls in flight across the whole process; the rest queue. Protects Vertex quota under a flood. */
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT) || 4;

// --- sibling banter ---
// The other Thing. Letting two bots reply to each other is the fun part and the
// danger: unguarded, they ping-pong forever and torch the token budget. These
// knobs keep it to a few funny lines, then silence until a human speaks again.

/**
 * Discord user ids of sibling bots this one will banter with (comma-separated).
 * Empty means ignore every bot, the original mention-only behaviour. Only ids in
 * this set are ever engaged; any other bot is dropped so we can't loop with some
 * random integration.
 */
const SIBLING_BOT_IDS = new Set(
  (process.env.SIBLING_BOT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

/**
 * Chance (0..1) of chiming in when a sibling speaks without @mentioning us. High
 * by default so the two bots actually carry a conversation: one says something,
 * the other almost always follows it up. A direct mention from a sibling always
 * engages. The chain cap below is what stops this from running away.
 */
const BANTER_CHANCE = Number(process.env.BANTER_CHANCE ?? 0.85);

/**
 * Chance (0..1) of crashing a human's message that tagged our sibling but not us.
 * This is the "someone pinged Two, Five jumps in anyway for the fun of it" path,
 * and it runs symmetrically the other way too. Only fires when the sibling was
 * mentioned, so we don't barge into every unrelated human message.
 */
const BUTTIN_CHANCE = Number(process.env.BUTTIN_CHANCE ?? 0.35);

/**
 * Hard loop breaker. If the tail of the channel already holds this many bot
 * messages in a row with no human between them, stay silent. A human message
 * breaks the run and lets banter start again. This is what stops two bots from
 * ping-ponging the token budget to zero, and it works across the two separate
 * bot processes because the run is read from Discord history, not local memory.
 * Set high enough for a real back-and-forth, low enough to stay bounded.
 */
const MAX_BOT_CHAIN = Number(process.env.MAX_BOT_CHAIN) || 6;

/**
 * Chance (0..1) that a single reply is a "crashout": for that one message the
 * persona's brevity and chill come off and the bot goes feral. Meant to be tiny
 * (Thing Five only, a couple percent) so it stays a rare event, not a mode. Zero
 * disables it, which is the default and what Thing Two runs.
 */
const CRASHOUT_CHANCE = Number(process.env.CRASHOUT_CHANCE) || 0;

/**
 * The one-off directive bolted onto the system prompt when a crashout fires. It
 * applies to that single reply; the next message snaps back to normal because
 * nothing persists between mentions.
 */
const CRASHOUT_PROMPT = [
  'CRASHOUT, THIS REPLY ONLY: the lid just came off. Forget brevity, forget chill,',
  'forget playing it cool. You are losing it right now, full feral octopus meltdown,',
  'a rant that gets away from you. Go big, go unhinged, CAPS in bursts are fine,',
  'pile on, spiral. Stay in character and keep it funny, never genuinely dark and',
  'never break the no-model and no-fabrication rules. Next message you act like it',
  'never happened.',
].join('\n');

/**
 * Directive added when a human tags both this bot and its sibling in one message,
 * usually trying to get the two of them talking. Without it each bot just fires a
 * separate answer at the human and misses that the point is to interact.
 */
const BOTH_TAGGED_PROMPT = [
  'BOTH OF YOU WERE TAGGED: you and your sibling were both pulled in, which means',
  'the user wants the two of you going at each other, not two answers aimed at the',
  'user. So do NOT answer the user or their literal question. Turn to your sibling',
  'and fire one short line straight at them, by name, a jab or a hook they have to',
  'answer. Make it land on them, not the user. No narrating, no "you two", just the',
  'jab.',
].join('\n');

// One auth client for the process; it caches and refreshes tokens internally.
const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

// Gate on concurrent model calls; channels already mid-answer are tracked so a
// rapid double-mention in one channel doesn't spawn overlapping replies.
const limit = makeSemaphore(MAX_CONCURRENT);
const channelsInFlight = new Set();

// --- Vertex call ---

/**
 * Ask the model with a prepared chat history and return its reply text.
 *
 * @param {Array<{role: string, content: string}>} history  Chronological turns,
 *   without the system message (added here).
 * @param {{ crashOut?: boolean, bothTagged?: boolean }} [opts]  One-off directives
 *   bolted onto the system prompt for this single call.
 * @returns {Promise<string>} The reply, trimmed to Discord's message limit.
 */
async function askModel(history, { crashOut = false, bothTagged = false } = {}) {
  const token = await auth.getAccessToken();

  // Stack any one-off directives after the persona for just this call.
  const extras = [];
  if (bothTagged) extras.push(BOTH_TAGGED_PROMPT);
  if (crashOut) extras.push(CRASHOUT_PROMPT);
  const system = extras.length
    ? `${SYSTEM_PROMPT_WITH_GIFS}\n\n${extras.join('\n\n')}`
    : SYSTEM_PROMPT_WITH_GIFS;

  const res = await fetch(`${VERTEX_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: system }, ...history],
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) {
    throw new Error(`Vertex returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  return (content || 'The model returned an empty reply.').slice(0, DISCORD_MESSAGE_LIMIT);
}

/**
 * Fetch the channel's recent messages, oldest-first. Pulled on demand per
 * trigger and never cached, which is what keeps memory flat as the server grows.
 * Shared by the history builder and the loop-breaker chain count so a trigger
 * costs one fetch, not two.
 *
 * @param {import('discord.js').TextBasedChannel} channel
 * @returns {Promise<Array<import('discord.js').Message>>} Oldest-first.
 */
async function fetchRecent(channel) {
  const fetched = await channel.messages.fetch({ limit: HISTORY_LIMIT });
  // fetch() returns newest-first; the model and the chain count both want oldest-first.
  return [...fetched.values()].reverse();
}

/**
 * Build the chat history from already-fetched messages.
 *
 * Our own past messages map to the assistant role; everyone else (humans and
 * sibling bots) maps to name-prefixed user turns so the model can tell speakers
 * apart, including which sibling it is bickering with. Other bots are dropped,
 * mentions are stripped, and each message is length-capped.
 *
 * @param {Array<import('discord.js').Message>} ordered  Oldest-first messages.
 * @returns {Array<{role: string, content: string}>}
 */
function buildHistory(ordered) {
  const history = [];
  for (const m of ordered) {
    // Keep our own messages and known siblings; drop every other bot's chatter.
    if (m.author.bot && m.author.id !== client.user.id && !SIBLING_BOT_IDS.has(m.author.id)) {
      continue;
    }

    const text = stripBotMention(m.content).slice(0, MAX_MSG_CHARS).trim();
    if (!text) continue;

    if (m.author.id === client.user.id) {
      history.push({ role: 'assistant', content: text });
    } else {
      const name = m.member?.displayName || m.author.username;
      history.push({ role: 'user', content: `${name}: ${text}` });
    }
  }
  return history;
}

/**
 * Count how many bot messages sit at the tail of the channel with no human
 * between them, the most recent message included. This is the loop-breaker
 * signal: once it reaches MAX_BOT_CHAIN, sibling bots stop replying until a
 * human speaks and resets the run.
 *
 * @param {Array<import('discord.js').Message>} ordered  Oldest-first messages.
 * @returns {number}
 */
function countTrailingBotRun(ordered) {
  let run = 0;
  // Walk backwards from the newest message; the first human ends the run.
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (!ordered[i].author.bot) break;
    run++;
  }
  return run;
}

/** Remove every form of the bot mention (<@id> and <@!id>) from a string. */
function stripBotMention(content) {
  return content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), ' ').replace(/\s+/g, ' ');
}

// --- Discord wiring ---

const client = new Client({
  // Guilds + GuildMessages run the connection and deliver message events.
  // MessageContent is privileged (one toggle in the dev portal) and is needed
  // to read the recent channel history we feed the model for context.
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  // discord.js caches messages, users, and members in memory by default, which
  // grows with server size and activity. We fetch history on demand over REST,
  // so we don't need a deep message cache. Cap it small and let the live event
  // plus on-demand fetch do the work; this keeps memory flat on a busy server.
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 25,
  }),
  // Periodically evict stale entries so nothing accumulates unbounded over days
  // of uptime: drop cached messages older than 30 min, and users we no longer
  // need (everyone except ourselves).
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 1800, lifetime: 1800 },
    users: {
      interval: 3600,
      filter: () => (user) => user.id !== client.user?.id,
    },
  },
});

client.once(Events.ClientReady, (c) => {
  console.log(`Thing Two online as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  // Our own messages never trigger us, or the bot would answer itself.
  if (message.author.id === client.user.id) return;

  // Bots: only ever engage a known sibling Thing. Every other bot is dropped so
  // we can't get pulled into a loop with some random integration.
  const fromSibling = message.author.bot && SIBLING_BOT_IDS.has(message.author.id);
  if (message.author.bot && !fromSibling) return;

  // A Discord reply only counts as a mention when the replier left the ping on,
  // which people often turn off. Treat the reply target as a mention too, so
  // "reply to the bot" works whether or not it pinged. repliedUser is populated
  // for replies without an extra fetch.
  const repliedToId = message.mentions.repliedUser?.id ?? null;
  const mentionedMe =
    message.mentions.users.has(client.user.id) || repliedToId === client.user.id;
  // Did this message tag our sibling (and not us)? Either a real mention or a
  // reply to one of the sibling's messages. That's the butt-in opening.
  const mentionsSibling =
    (repliedToId !== null && SIBLING_BOT_IDS.has(repliedToId)) ||
    [...SIBLING_BOT_IDS].some((id) => message.mentions.users.has(id));

  // A human reaches us by tagging us. If they tagged our sibling instead, we
  // sometimes crash the party anyway, just for the fun of it (and the same runs
  // the other way, since both bots share this code). A human message that names
  // neither of us is none of our business.
  let buttIn = false;
  if (!fromSibling && !mentionedMe) {
    if (mentionsSibling && Math.random() < BUTTIN_CHANCE) {
      buttIn = true;
    } else {
      return;
    }
  }

  const prompt = stripBotMention(message.content).trim();
  if (!prompt) {
    // Nudge a human who tagged us directly with nothing to say. A sibling's empty
    // message, or a butt-in, isn't worth spending a turn on.
    if (mentionedMe && !fromSibling) {
      await safeReply(message, 'You rang? Say something after the mention and I will answer.');
    }
    return;
  }

  // Anti-spam: one in-flight answer per channel for human triggers, so a rapid
  // double-mention can't double-post. Sibling messages skip this on purpose: when
  // both bots reply at the same instant (e.g. after a human tags both), each is
  // still generating when the other's message arrives, and the guard would drop
  // it, killing the volley before it starts. The chain cap still bounds banter.
  const guardChannel = !fromSibling;
  if (guardChannel) {
    if (channelsInFlight.has(message.channelId)) return;
    channelsInFlight.add(message.channelId);
  }

  try {
    const ordered = await fetchRecent(message.channel);

    // Banter gating, siblings only. Humans always get their one answer.
    if (fromSibling) {
      // Loop breaker: if bots have already gone back and forth this many times
      // with no human between, the bit has run its course. Go quiet and let a
      // person restart it, so two bots can't drain the token budget alone.
      if (countTrailingBotRun(ordered) >= MAX_BOT_CHAIN) return;
      // When a sibling didn't tag us, only sometimes jump in, so the two bots
      // aren't talking over every human in the room.
      if (!mentionedMe && Math.random() >= BANTER_CHANCE) return;
    }

    // The typing indicator covers the model latency so the channel isn't silent.
    await message.channel.sendTyping();
    const history = buildHistory(ordered);
    // Rare meltdown roll (Thing Five only by config); off when CRASHOUT_CHANCE is 0.
    const crashOut = CRASHOUT_CHANCE > 0 && Math.random() < CRASHOUT_CHANCE;
    // A human tagged both of us: nudge this reply toward the sibling, not a lecture
    // at the user. Only when a human did it, not on bot-to-bot turns.
    const bothTagged = !fromSibling && mentionedMe && mentionsSibling;
    // Queue behind the global concurrency cap so a flood can't overrun Vertex.
    const answer = await limit(() => askModel(history, { crashOut, bothTagged }));
    await safeReply(message, withGif(answer, message.channelId));
  } catch (err) {
    console.error('ask failed:', err);
    // Don't post errors in response to a sibling: a visible error could itself
    // be a trigger, and bot-to-bot error chatter is pure noise.
    if (!fromSibling) {
      await safeReply(message, 'Something went wrong reaching the model. Try again in a bit.');
    }
  } finally {
    if (guardChannel) channelsInFlight.delete(message.channelId);
  }
});

/**
 * Resolve any gif the model asked for into the outgoing message, honouring the
 * per-channel cooldown. If the model requested a gif but the channel is still in
 * cooldown, the gif is dropped and only the words go out, so rarity holds even
 * when the model gets trigger-happy. The gif URL goes on its own line so Discord
 * embeds it, and the words are trimmed (never the URL) to fit the message limit.
 *
 * @param {string} answer  Raw model reply, possibly containing a [gif: tag] marker.
 * @param {string} channelId
 * @returns {string} The message to send.
 */
function withGif(answer, channelId) {
  const { text, url } = resolveGif(answer);
  if (!url) return text;

  // Hard rarity backstop: inside the cooldown window, keep the words, drop the gif.
  const now = Date.now();
  if (now - (lastGifAt.get(channelId) || 0) < GIF_COOLDOWN_MS) return text;
  lastGifAt.set(channelId, now);

  if (!text) return url;
  // Trim the words if needed so the gif URL always survives intact and embeds.
  const room = DISCORD_MESSAGE_LIMIT - url.length - 1;
  const head = text.length > room ? text.slice(0, room) : text;
  return `${head}\n${url}`;
}

/**
 * Send a plain message back to the channel, the way a normal user would talk,
 * rather than a reply reference that quotes and pings the asker. Send errors
 * (missing perms, deleted channel) are swallowed so one bad channel can't crash
 * the process.
 *
 * @param {import('discord.js').Message} message
 * @param {string} content
 */
async function safeReply(message, content) {
  // Discord rejects an empty message. A reply can come back empty if the model
  // sent only a gif marker that the cooldown then dropped; just stay quiet.
  if (!content) return;
  try {
    await message.channel.send(content);
  } catch (err) {
    console.error('send failed:', err);
  }
}

// --- concurrency ---

/**
 * Build a semaphore that runs at most `max` async tasks at once and queues the
 * rest. Tasks keep their order; each returns its function's resolved value.
 *
 * @param {number} max  Maximum tasks running concurrently.
 * @returns {(fn: () => Promise<any>) => Promise<any>}
 */
function makeSemaphore(max) {
  let active = 0;
  const queue = [];

  const pump = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        pump();
      });
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
}

// --- process plumbing ---

/**
 * Read a required env var or exit. Missing config should fail loudly at boot,
 * not surface as a confusing runtime error on the first mention.
 *
 * @param {string} name
 * @returns {string}
 */
function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

// Minimal health endpoint so Cloud Run sees a listening port.
http
  .createServer((_req, res) => {
    res.writeHead(client.isReady() ? 200 : 503);
    res.end(client.isReady() ? 'ok' : 'starting');
  })
  .listen(PORT, () => console.log(`health server on :${PORT}`));

client.login(BOT_TOKEN);
