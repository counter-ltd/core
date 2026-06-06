// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * rel="me" link verification: proving a user controls an external page.
 *
 * The IndieAuth-style handshake is simple. The user links their Counter profile
 * from somewhere they control (a `<link rel="me">` or `<a rel="me">` pointing
 * back at their Counter URL). We fetch that page and check the link-back is
 * really there. If it is, they've demonstrated control of both ends, so the
 * platform link earns a verified badge.
 */

// Cap how much of a page we read: a real <head> with rel=me links is tiny, and
// we don't want a hostile or runaway page to stream megabytes at the Worker.
const MAX_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 8000;

/**
 * Pull every rel="me" href out of an HTML string.
 *
 * Matches both `<link rel="me" href>` and `<a rel="me" href>`, in either
 * attribute order, and tolerates extra rel tokens (rel="me noopener"). Pure and
 * synchronous so it's easy to test without a network.
 *
 * @param html  Raw HTML.
 * @returns     The href values whose rel attribute includes a "me" token.
 */
export function extractRelMe(html: string): string[] {
  const out: string[] = [];
  // Each <a>/<link> tag, then check it for a rel containing "me" and grab href.
  // A coarse tag scan is enough; we're looking for one specific needle, not
  // building a DOM.
  const tags = html.match(/<(?:a|link)\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const rel = tag.match(/\brel\s*=\s*["']([^"']*)["']/i)?.[1];
    if (!rel) continue;
    if (!rel.toLowerCase().split(/\s+/).includes('me')) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1];
    if (href) out.push(href);
  }
  return out;
}

/** Normalize a URL for comparison: drop the scheme, trailing slash, and case. */
function canonical(u: string): string {
  return u
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/**
 * Fetch `pageUrl` and check it links back to `profileUrl` via rel="me".
 *
 * Returns false on any problem, a fetch error, a timeout, an oversized body, no
 * matching link, so a flaky or hostile page reads as "not verified" rather than
 * throwing. The comparison ignores scheme and trailing slash so http/https and
 * a stray slash don't cause a false negative.
 *
 * @param pageUrl     The user-controlled page to inspect.
 * @param profileUrl  The Counter profile URL the page must link back to.
 */
export async function verifyRelMe(pageUrl: string, profileUrl: string): Promise<boolean> {
  try {
    const res = await fetch(pageUrl, {
      redirect: 'follow',
      headers: { accept: 'text/html', 'user-agent': 'Counter-rel-me-verifier' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) return false;

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total >= MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
    const html = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());

    const want = canonical(profileUrl);
    return extractRelMe(html).some((href) => canonical(href) === want);
  } catch {
    return false;
  }
}
