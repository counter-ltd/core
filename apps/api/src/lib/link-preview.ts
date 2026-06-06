// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Server-side OG/meta preview fetcher.
 *
 * Runs inside the Worker so the user's IP never reaches the target site and
 * CORS is a non-issue. Follows the same read-cap-then-parse pattern as
 * relme.ts: cap at 64 KB (enough for any <head>), 5-second timeout, returns
 * null on any failure so the caller treats a bad preview as a quiet no-op.
 */

const MAX_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 5000;

/** OG/meta data extracted from a linked page. Fields are null when absent in the source HTML. */
export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

/** Extract a <meta property/name="key" content="…"> value. Handles both attribute orders. */
function metaContent(html: string, key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']|` +
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`,
    'i',
  );
  const m = html.match(re);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

function titleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1]?.trim() ?? null;
}

/** Resolve a potentially relative OG image URL against the page origin. */
function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/**
 * Block fetches to loopback and RFC-1918 addresses.
 *
 * Cloudflare Workers already block private-IP fetches in production, but this
 * guard also protects the Bun-based local dev server where no such restriction
 * applies.
 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h.endsWith('.local') ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

/**
 * Fetch OG/meta preview data for a URL.
 *
 * Returns null on any problem: invalid URL, private host, timeout, non-HTML
 * response, or parse failure. Callers should treat null as "no preview
 * available" rather than an error.
 *
 * @param rawUrl  The URL to preview.
 */
export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreviewData | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (isPrivateHost(parsed.hostname)) return null;

  try {
    const res = await fetch(parsed.href, {
      redirect: 'follow',
      headers: {
        accept: 'text/html',
        'user-agent': 'Counter-preview/1.0 (+https://counter.ltd)',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok || !res.body) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) return null;

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

    const title =
      metaContent(html, 'og:title') ??
      metaContent(html, 'twitter:title') ??
      titleTag(html) ??
      null;
    const description =
      metaContent(html, 'og:description') ??
      metaContent(html, 'twitter:description') ??
      metaContent(html, 'description') ??
      null;
    const rawImage =
      metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image') ?? null;
    const image = rawImage ? resolveUrl(rawImage, parsed.href) : null;
    const siteName = metaContent(html, 'og:site_name') ?? null;

    return {
      url: parsed.href,
      title: title ? title.slice(0, 200) : null,
      description: description ? description.slice(0, 400) : null,
      image,
      siteName: siteName ? siteName.slice(0, 100) : null,
    };
  } catch {
    return null;
  }
}
