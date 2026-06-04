// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Display formatters for the feed: short timestamps, compact counts, and
 * turning post text into safe linked markup.
 *
 * These run on both server and client, so they stay pure and dependency-free
 * and lean on the platform's own `Intl`/`Date` rather than a formatting lib.
 */

/**
 * Compact relative time for timeline rows, e.g. "now", "5m", "3h", "2d".
 *
 * Anything older than a week falls back to an absolute "Mar 4" style date,
 * since "53d" stops meaning anything useful past that point.
 */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  // Clamp negatives so a clock skew that puts the post slightly in the future
  // reads as "now" instead of a nonsensical negative age.
  const secs = Math.max(0, (Date.now() - then) / 1000);
  if (secs < 45) return 'now';
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  if (secs < 604800) return `${Math.round(secs / 86400)}d`;
  // `undefined` locale lets the browser pick the reader's own date format.
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Abbreviate large counts the way social UIs do: 1.2k, 3.4M.
 *
 * Sub-10k keeps one decimal ("1.2k") because the precision still reads well;
 * past that we drop it ("34k") so the label stays short. A trailing ".0" is
 * stripped so we never show "2.0k".
 */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/**
 * Render a post body to HTML with @mentions and #hashtags turned into links.
 *
 * The output is injected as raw HTML, so escaping has to come first and has to
 * be total: we escape the whole body before adding any of our own markup, so a
 * body like `<script>` can never break out into live tags.
 */
export function linkify(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped
    // Tags allow any-language letters/digits (\p{L}\p{N}) so non-Latin
    // hashtags work; the leading (^|\s) stops us linking a '#' mid-word.
    .replace(/(^|\s)#([\p{L}\p{N}_]+)/gu, '$1<a class="tag" href="/tags/$2">#$2</a>')
    // Handles are ASCII-only, matching the rules the API enforces on signup.
    .replace(/(^|\s)@([a-z0-9_]+)/gi, '$1<a class="mention" href="/$2">@$2</a>')
    .replace(/\n/g, '<br>');
}
