// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Thing Five's second job: announcing app builds in Discord.
 *
 * The off-device upload pipeline (ASCManager-MacOS) POSTs /build/announce right
 * after a build lands in App Store Connect. The route authenticates the caller
 * with a shared bearer secret (it's not GitHub-signed) and hands the payload
 * here. This turns it into a Discord message in Five's voice — the same quip +
 * summary shape as a commit announcement — and posts it as Five via his bot
 * token, to the build channel (falling back to the commit channel).
 *
 * Fails soft like the commit path: the quip is best-effort, the summary always
 * ships, and the whole thing swallows its own errors so a bad payload can't
 * surface as an unhandled rejection in `waitUntil`.
 */

import { postAsThingFive, thingFiveReact, type ThingFiveQuipEnv } from './commit-announce.ts';

/** Discord caps a single message at 2000 characters. */
const DISCORD_MESSAGE_LIMIT = 2000;
/** Keep a forwarded changelog from dominating the message. */
const CHANGELOG_MAX = 1200;

/** Config this module needs, a subset of the validated server env. */
export interface BuildAnnounceEnv extends ThingFiveQuipEnv {
  THING_FIVE_BOT_TOKEN: string;
  BUILD_ANNOUNCE_SECRET: string;
  DISCORD_BUILD_CHANNEL_ID: string;
  DISCORD_COMMIT_CHANNEL_ID: string;
}

/** The shape ASCManager POSTs. Everything but `app` is optional. */
export interface BuildAnnouncePayload {
  app?: string;
  version?: string;
  build?: string | number;
  platform?: string;
  changelog?: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  ios: 'iOS · TestFlight',
  macos: 'macOS · Mac App Store',
};

/** "1.2.0 (B45)" / "1.2.0" / "B45" / "" — whichever pieces we were given. */
function versionLabel(payload: BuildAnnouncePayload): string {
  const version = String(payload.version ?? '').trim();
  const build = String(payload.build ?? '').trim();
  return [version, build && `(B${build})`].filter(Boolean).join(' ');
}

/**
 * Render the plain build summary: app, version, platform, and the forwarded
 * changelog if any. Mirrors the commit summary's bold-lead, mono-detail style.
 */
function buildSummary(payload: BuildAnnouncePayload): string {
  const app = String(payload.app ?? 'an app').trim();
  const ver = versionLabel(payload);
  const platform = String(payload.platform ?? '').trim().toLowerCase();
  const label = PLATFORM_LABEL[platform] ?? platform;

  const head = [`**${app}**`, ver && `\`${ver}\``, label && `— ${label}`].filter(Boolean).join(' ');
  const notes = String(payload.changelog ?? '').trim().slice(0, CHANGELOG_MAX);
  return notes ? `${head}\n${notes}` : `${head} — new build is processing.`;
}

/**
 * Build, voice, and post the announcement for an uploaded build. Safe to run in
 * `waitUntil`: it swallows its own errors.
 */
export async function announceBuild(env: BuildAnnounceEnv, payload: BuildAnnouncePayload): Promise<void> {
  try {
    const summary = buildSummary(payload);
    const quip = await thingFiveReact(env, buildQuipPrompt(payload)).catch(() => '');

    const body = quip ? `${quip}\n\n${summary}` : summary;
    const channel = env.DISCORD_BUILD_CHANNEL_ID || env.DISCORD_COMMIT_CHANNEL_ID;
    await postAsThingFive(env, body.slice(0, DISCORD_MESSAGE_LIMIT), channel);
  } catch (err) {
    console.error('build announce failed:', err);
  }
}

/** Frame the quip the same way the commit path does: react, don't summarize. */
function buildQuipPrompt(payload: BuildAnnouncePayload): string {
  const app = String(payload.app ?? 'an app').trim();
  const ver = versionLabel(payload);
  const platform = String(payload.platform ?? '').trim().toLowerCase();
  const notes = String(payload.changelog ?? '').trim().slice(0, 600);

  return [
    'A new app build just went up to App Store Connect. This is your job now:',
    'announce it with one short, dry reaction in your voice. One line, maybe two.',
    "Do not list the changelog or repeat its wording, that gets posted under you.",
    'Just react.',
    '',
    `app: ${app}`,
    ver ? `version: ${ver}` : 'version: (unknown)',
    platform ? `platform: ${platform}` : '',
    'changelog:',
    notes || '- (no notes)',
  ]
    .filter(Boolean)
    .join('\n');
}
