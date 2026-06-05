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
 * It acts only when @mentioned. On a mention it pulls the last few messages of
 * that one channel to answer with context, then forgets them. Nothing is stored
 * between mentions and non-mention traffic is ignored, so the footprint stays
 * flat no matter how large the server grows: work happens only on a mention.
 * Reading recent history needs the privileged Message Content intent (one toggle
 * in the developer portal).
 *
 * Auth to Vertex is via Application Default Credentials: on Cloud Run the
 * runtime service account is picked up automatically, so there is no key file
 * here. That account needs roles/aiplatform.user.
 */

import http from 'node:http';
import { Client, Events, GatewayIntentBits, Options } from 'discord.js';
import { GoogleAuth } from 'google-auth-library';

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
 * @returns {Promise<string>} The reply, trimmed to Discord's message limit.
 */
async function askModel(history) {
  const token = await auth.getAccessToken();

  const res = await fetch(`${VERTEX_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
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
 * Build the chat history for a mention by fetching the channel's recent messages
 * on demand. Nothing is cached between mentions, which is what keeps memory flat
 * as the server grows.
 *
 * The bot's own past messages map to the assistant role; everyone else's map to
 * user turns, name-prefixed so the model can tell speakers apart. Bot mentions
 * are stripped and each message is length-capped.
 *
 * @param {import('discord.js').Message} message  The triggering mention.
 * @returns {Promise<Array<{role: string, content: string}>>}
 */
async function buildHistory(message) {
  const fetched = await message.channel.messages.fetch({ limit: HISTORY_LIMIT });
  // fetch() returns newest-first; the model wants oldest-first.
  const ordered = [...fetched.values()].reverse();

  const history = [];
  for (const m of ordered) {
    // Skip other bots' chatter; keep our own messages as assistant context.
    if (m.author.bot && m.author.id !== client.user.id) continue;

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
  // Ignore other bots and our own messages so two bots can't loop each other.
  if (message.author.bot) return;
  // Only act when actually mentioned. A role mention or @everyone doesn't count.
  if (!message.mentions.users.has(client.user.id)) return;

  const prompt = stripBotMention(message.content).trim();
  if (!prompt) {
    await safeReply(message, 'You rang? Say something after the mention and I will answer.');
    return;
  }

  // One answer per channel at a time: drop a second mention that lands while the
  // first is still being answered, so a channel can't pile up overlapping calls.
  if (channelsInFlight.has(message.channelId)) return;
  channelsInFlight.add(message.channelId);

  try {
    // The typing indicator covers the model latency so the channel isn't silent.
    await message.channel.sendTyping();
    const history = await buildHistory(message);
    // Queue behind the global concurrency cap so a flood can't overrun Vertex.
    const answer = await limit(() => askModel(history));
    await safeReply(message, answer);
  } catch (err) {
    console.error('ask failed:', err);
    await safeReply(message, 'Something went wrong reaching the model. Try again in a bit.');
  } finally {
    channelsInFlight.delete(message.channelId);
  }
});

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
