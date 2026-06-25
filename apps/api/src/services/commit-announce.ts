// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Thing Five's day job: announcing GitHub pushes in Discord.
 *
 * A GitHub org webhook hits the API on every push. The route verifies the
 * delivery signature and hands the payload here. This module turns a push into a
 * Discord message in Thing Five's voice (a short quip from the model, then a
 * clean commit summary) and posts it as Five via his bot token.
 *
 * Everything here fails soft. The quip is best-effort: if the model call dies,
 * Five still posts the plain summary, because the announcement is the job and the
 * joke is the garnish. Signature verification is the one thing that does not bend.
 */

import { getGoogleAccessToken } from './google-auth.ts';

/** Discord REST base, same version the rest of the bot code targets. */
const DISCORD_API = 'https://discord.com/api/v10';

/** Discord caps a single message at 2000 characters. */
const DISCORD_MESSAGE_LIMIT = 2000;

/** At most this many commits are listed in a summary; the rest collapse to "+N more". */
const MAX_COMMITS_SHOWN = 5;

/** First line of a commit message (the title), empty string if there's nothing. */
function firstLine(message: string | undefined): string {
  return (message ?? '').split('\n')[0] ?? '';
}

/** Config this module needs, a subset of the validated server env. */
export interface CommitAnnounceEnv {
  OPENAI_BASE_URL: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  GOOGLE_SA_CLIENT_EMAIL: string;
  GOOGLE_SA_PRIVATE_KEY: string;
  THING_FIVE_SYSTEM_PROMPT: string;
  THING_FIVE_SYSTEM_PROMPT_2: string;
  THING_FIVE_SYSTEM_PROMPT_3?: string;
  THING_FIVE_BOT_TOKEN: string;
  GITHUB_WEBHOOK_SECRET: string;
  DISCORD_COMMIT_CHANNEL_ID: string;
  GITHUB_COMMIT_ORGS: string;
}

/** The slice of a GitHub push payload this module reads. */
export interface GithubPushPayload {
  ref?: string;
  deleted?: boolean;
  compare?: string;
  repository?: {
    full_name?: string;
    default_branch?: string;
    owner?: { name?: string; login?: string };
  };
  pusher?: { name?: string };
  commits?: Array<{
    id?: string;
    message?: string;
    author?: { name?: string; username?: string };
  }>;
  head_commit?: { id?: string; message?: string } | null;
}

// --- signature verification ---

/**
 * Verify a GitHub webhook delivery against the shared secret.
 *
 * GitHub signs the raw body with HMAC-SHA256 and sends it as the
 * `x-hub-signature-256: sha256=<hex>` header. We recompute and compare in
 * constant time. WebCrypto only, so this runs on Workers.
 *
 * @param secret     The configured webhook secret.
 * @param header     The `x-hub-signature-256` header value, or null.
 * @param rawBody    The exact request body bytes GitHub signed.
 * @returns true only when the signature is present and matches.
 */
export async function verifyGithubSignature(
  secret: string,
  header: string | null,
  rawBody: string,
): Promise<boolean> {
  if (!secret || !header) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = `sha256=${toHex(sigBytes)}`;

  return timingSafeEqual(expected, header);
}

/** Hex-encode an ArrayBuffer, lowercase, the format GitHub uses. */
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time string compare. Bails fast only on length, which a signature
 * scheme leaks anyway; the per-character work never short-circuits, so it does
 * not reveal how far a forged signature matched.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// --- push handling ---

/**
 * Decide whether a push should be announced, and on what branch.
 *
 * We only announce pushes to the repo's default branch (feature-branch noise is
 * not worth it), skip branch deletions, skip pushes with no commits, and skip
 * repos whose owner is not in the orgs allowlist.
 *
 * @returns The branch name to announce, or null to ignore this push.
 */
export function branchToAnnounce(payload: GithubPushPayload, allowedOrgs: string[]): string | null {
  if (payload.deleted) return null;
  if (!payload.commits || payload.commits.length === 0) return null;

  const ref = payload.ref ?? '';
  const defaultBranch = payload.repository?.default_branch ?? '';
  if (!defaultBranch || ref !== `refs/heads/${defaultBranch}`) return null;

  const owner = (payload.repository?.owner?.login ?? payload.repository?.owner?.name ?? '')
    .toLowerCase();
  // Empty allowlist means "any org"; otherwise the owner must be listed.
  if (allowedOrgs.length > 0 && !allowedOrgs.includes(owner)) return null;

  return defaultBranch;
}

/**
 * Build, voice, and post the announcement for a verified push. Safe to run in
 * `waitUntil`: it swallows its own errors so a bad push can't surface as an
 * unhandled rejection.
 *
 * @param env      Announce config from the server env.
 * @param payload  The GitHub push payload.
 * @param branch   The branch name from branchToAnnounce.
 */
export async function announcePush(
  env: CommitAnnounceEnv,
  payload: GithubPushPayload,
  branch: string,
): Promise<void> {
  try {
    const summary = buildCommitSummary(payload, branch);
    // The quip is garnish: if it fails, the summary still ships.
    const quip = await thingFiveQuip(env, payload, branch).catch(() => '');

    const body = quip ? `${quip}\n\n${summary}` : summary;
    await postAsThingFive(env, body.slice(0, DISCORD_MESSAGE_LIMIT), env.DISCORD_COMMIT_CHANNEL_ID);
  } catch (err) {
    console.error('commit announce failed:', err);
  }
}

/**
 * Render the plain commit summary: repo and branch, each commit's short sha,
 * first line, and author, capped at MAX_COMMITS_SHOWN, then the compare link.
 */
function buildCommitSummary(payload: GithubPushPayload, branch: string): string {
  const repo = payload.repository?.full_name ?? 'a repo';
  const commits = payload.commits ?? [];

  const shown = commits.slice(0, MAX_COMMITS_SHOWN).map((c) => {
    const sha = (c.id ?? '').slice(0, 7);
    // Only the first line of the message; commit bodies can be paragraphs.
    const title = firstLine(c.message).slice(0, 120);
    const who = c.author?.username ?? c.author?.name ?? 'someone';
    return `\`${sha}\` ${title} (${who})`;
  });

  const extra = commits.length - shown.length;
  const more = extra > 0 ? `\n...and ${extra} more` : '';
  const count = commits.length === 1 ? '1 commit' : `${commits.length} commits`;
  const link = payload.compare ? `\n${payload.compare}` : '';

  return `**${repo}** \`${branch}\` — ${count}\n${shown.join('\n')}${more}${link}`;
}

// --- model quip ---

/** Minimal shape of an OpenAI chat-completions response. */
interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * The config slice the model-voiced quip needs: an OpenAI-compatible endpoint,
 * some auth (Google SA or static key), and Five's split persona prompt. Shared
 * by commit and build announcements so both speak in the same voice.
 */
export interface ThingFiveQuipEnv {
  OPENAI_BASE_URL: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  GOOGLE_SA_CLIENT_EMAIL: string;
  GOOGLE_SA_PRIVATE_KEY: string;
  THING_FIVE_SYSTEM_PROMPT: string;
  THING_FIVE_SYSTEM_PROMPT_2: string;
  THING_FIVE_SYSTEM_PROMPT_3?: string;
}

/** True when there's enough config to make a model call for the quip. */
function quipConfigured(env: ThingFiveQuipEnv): boolean {
  if (!env.OPENAI_BASE_URL) return false;
  const hasGoogle = Boolean(env.GOOGLE_SA_PRIVATE_KEY && env.GOOGLE_SA_CLIENT_EMAIL);
  return hasGoogle || Boolean(env.OPENAI_API_KEY);
}

/**
 * Ask the model for a one-line reaction in Thing Five's voice, given a framed
 * user turn. Returns '' when chat isn't configured, the persona prompt is unset,
 * or the call yields nothing — so callers can drop the quip and post the bare
 * summary. Shared by commit and build announcements.
 */
export async function thingFiveReact(env: ThingFiveQuipEnv, userPrompt: string): Promise<string> {
  if (!quipConfigured(env)) return '';

  const system =
    (env.THING_FIVE_SYSTEM_PROMPT ?? '') +
    (env.THING_FIVE_SYSTEM_PROMPT_2 ?? '') +
    (env.THING_FIVE_SYSTEM_PROMPT_3 ?? '');
  if (!system) return '';

  const base = env.OPENAI_BASE_URL.replace(/\/+$/, '');
  const bearer = await resolveBearer(env);

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) return '';
  const data = (await res.json()) as ChatCompletion;
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

/**
 * Ask the model for a one-line Thing Five reaction to the push. Returns '' when
 * chat isn't configured or the call yields nothing, so the caller drops the quip
 * and posts the summary alone.
 */
async function thingFiveQuip(
  env: CommitAnnounceEnv,
  payload: GithubPushPayload,
  branch: string,
): Promise<string> {
  const repo = payload.repository?.full_name ?? 'a repo';
  const messages = (payload.commits ?? [])
    .slice(0, MAX_COMMITS_SHOWN)
    .map((c) => `- ${firstLine(c.message)}`)
    .join('\n');

  // The user turn frames the job: react, do not summarize (the summary is posted
  // separately), and stay short so it reads as a reaction, not a paragraph.
  const userPrompt = [
    'The developer just pushed code to GitHub. This is your job now: announce it',
    'with one short, dry reaction in your voice. One line, maybe two. Do not list',
    'the commits or repeat their wording, that gets posted under you. Just react.',
    '',
    `repo: ${repo}`,
    `branch: ${branch}`,
    'commit messages:',
    messages || '- (no messages)',
  ].join('\n');

  return thingFiveReact(env, userPrompt);
}

/** Resolve the model bearer: a minted Google token, else the static key. */
async function resolveBearer(env: ThingFiveQuipEnv): Promise<string> {
  if (env.GOOGLE_SA_PRIVATE_KEY && env.GOOGLE_SA_CLIENT_EMAIL) {
    return getGoogleAccessToken({
      clientEmail: env.GOOGLE_SA_CLIENT_EMAIL,
      privateKey: env.GOOGLE_SA_PRIVATE_KEY,
    });
  }
  return env.OPENAI_API_KEY;
}

// --- discord post ---

/**
 * Post a message to a channel as Thing Five, using his bot token. No-op when the
 * token or channel id is missing, so a half-configured deploy verifies webhooks
 * without erroring on the post. Shared by commit and build announcements — the
 * caller picks the channel.
 */
export async function postAsThingFive(
  env: { THING_FIVE_BOT_TOKEN: string },
  content: string,
  channelId: string,
): Promise<void> {
  if (!env.THING_FIVE_BOT_TOKEN || !channelId) return;

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${env.THING_FIVE_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    throw new Error(`Discord channel post returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
