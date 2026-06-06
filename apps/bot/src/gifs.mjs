// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Curated reaction gifs for the Thing bots.
 *
 * Discord renders a bare gif URL (a tenor.com/view link or a direct .gif) as a
 * playing gif, so "the bot posts a gif" just means its reply contains a real gif
 * URL. The model can't browse, so it can't produce working URLs on its own: a
 * guessed Tenor link 404s and embeds as nothing. Instead the model picks a short
 * TAG from a menu and writes a marker, [gif: tag], and this module swaps that
 * marker for the real URL behind the tag.
 *
 * The map below is the single source of truth. A tag is only offered to the model
 * (and only resolvable) once it has a real URL, so the whole feature stays dormant
 * until you fill some in: the bots behave exactly as before, no broken embeds.
 *
 * To add a gif: in Discord, right-click the gif you want -> Copy Link, then paste
 * that URL as the value here under a short, lowercase tag. Keep the set small and
 * funny; variety is not the point, the right reaction at the right moment is.
 *
 * Rarity is NOT enforced here. This module is pure (no timers, no Date) so it is
 * easy to test; the caller (index.mjs) holds the per-channel cooldown that keeps
 * gifs a punchline instead of wallpaper. Later, a Tenor-API resolver can sit
 * behind the same marker without touching the caller.
 */

/**
 * Tag -> gif URL. Empty-string (or non-http) values are treated as "not set yet"
 * and are skipped everywhere, so you can leave suggested tags stubbed until you
 * find a gif you like for them.
 *
 * @type {Record<string, string>}
 */
export const GIFS = {
  // Starter set of Tenor reaction gifs. To swap one, right-click a gif in Discord
  // -> Copy Link and paste the URL here. To disable one, set it to ''.
  shrug: 'https://tenor.com/view/shrug-reaction-gif-23625366',
  'eye-roll': 'https://tenor.com/view/davika-hoorne-eye-roll-reaction-gif-10717260',
  popcorn: 'https://tenor.com/view/popcorn-total-drama-dont-bother-im-eating-watching-gif-17429641',
  'slow-clap': 'https://tenor.com/view/slow-clap-sarcastic-clapping-rick-and-morty-gif-16916466',
  facepalm: 'https://tenor.com/view/facepalm-gif-23730687',
  'mic-drop': 'https://tenor.com/view/mic-drop-gif-24176883',
  'this-is-fine': 'https://tenor.com/view/this-is-fine-fire-burning-life-living-gif-6373010',
  smug: 'https://tenor.com/view/smug-smirk-sass-sassy-atti-gif-11306138752300935014',
  nope: 'https://tenor.com/view/no-nope-no-way-walking-away-gif-15186092',
  'side-eye': 'https://tenor.com/view/suspicious-side-eye-gif-14293058626579193492',
  bored: 'https://tenor.com/view/bored-waiting-wait-boring-sigh-gif-6328299744077657499',
  octopus: 'https://tenor.com/view/octopus-gif-21006808',
  'chefs-kiss': 'https://tenor.com/view/chefs-kiss-gif-14243454564723684304',
  'deal-with-it': 'https://tenor.com/view/deal-with-it-sun-glasses-gif-11684743',
};

/** A value counts as a real gif only if it looks like a URL. */
function isUrl(v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v);
}

/**
 * The tags that actually have a gif behind them, lowercased. This is both the
 * menu shown to the model and the allowlist the resolver checks against.
 *
 * @returns {string[]}
 */
export function enabledGifTags() {
  return Object.keys(GIFS).filter((tag) => isUrl(GIFS[tag]));
}

/**
 * The instruction block appended to the system prompt that tells the model the
 * gif protocol and which tags exist. Returns '' when no gifs are configured, so
 * the model is never told about a feature it can't use (and so won't emit
 * markers that would just get stripped).
 *
 * @returns {string}
 */
export function gifPromptSection() {
  const tags = enabledGifTags();
  if (tags.length === 0) return '';

  return [
    'GIFS: you can react with a gif when it fits the moment. End the message with a',
    'marker on its own line, exactly like this:',
    '  [gif: TAG]',
    'TAG must be one of these and nothing else:',
    `  ${tags.join(', ')}`,
    'Reach for one when it genuinely adds to the joke or the reaction, a beat the',
    'words alone cannot land, like a smug, a side-eye, a slow-clap at the right',
    'moment. At most one gif per message, and do not tack one onto every turn.',
    'Never invent a tag, never describe the gif in words, never use one to answer a',
    'real question.',
  ].join('\n');
}

/** Strips every gif marker from a string and tidies the leftover whitespace. */
function stripMarkers(text) {
  return text
    .replace(/\[gif:[^\]]*\]/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Pull the gif out of a model reply.
 *
 * Reads the first [gif: tag] marker, removes all markers from the text, and
 * resolves the tag to a URL when it is a known, enabled tag. Only the first
 * marker counts; a model that emits several still yields at most one gif.
 *
 * The caller decides whether to actually attach the URL (the cooldown lives
 * there). This just reports what the model asked for and hands back clean text.
 *
 * @param {string} text  The raw model reply.
 * @returns {{ text: string, url: string | null }}  Cleaned text, and the gif URL
 *   the model requested, or null if it asked for none or for an unknown tag.
 */
export function resolveGif(text) {
  const match = text.match(/\[gif:\s*([^\]]+)\]/i);
  const cleaned = stripMarkers(text);
  if (!match) return { text: cleaned, url: null };

  const tag = match[1].trim().toLowerCase();
  const url = isUrl(GIFS[tag]) ? GIFS[tag] : null;
  return { text: cleaned, url };
}
