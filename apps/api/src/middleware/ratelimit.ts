// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * A fixed-window, in-memory rate limiter.
 *
 * Requests are counted per key (the logged-in user id, or the Cloudflare client
 * IP hint for anonymous callers) inside a rolling time window. Go over the
 * limit and you get a 429 until the window rolls.
 *
 * Two properties worth calling out. The IP key lives only in isolate memory and
 * is never written anywhere, because Counter does not log IPs. And on Workers
 * this counts per-isolate, so under load the limit is approximate (each isolate
 * counts on its own). If we ever need a strict global cap, swap this for
 * a Durable Object or the Workers Rate Limiting binding; the `X-RateLimit-*`
 * header contract below stays the same either way.
 */
import { createMiddleware } from 'hono/factory';
import { RATE_LIMIT } from '@counter/config';
import { errors } from '../lib/errors.ts';
import type { AppEnv } from '../types.ts';

/** One key's tally: how many hits this window, and when the window expires. */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Drop expired buckets so the map doesn't grow without bound.
 *
 * We can't use a background timer to do this (Workers disallows them), so we
 * sweep opportunistically on the request path, and only once the map is large
 * enough to be worth the scan.
 */
function sweep(now: number): void {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Pick the bucket key for a request: the user id if we know it, otherwise a
 * best-effort grouping by client IP. The `u:` / `a:` prefixes keep the two
 * namespaces from ever colliding.
 */
function keyFor(c: { get: (k: 'userId') => string | undefined; req: { header: (n: string) => string | undefined } }): string {
  const userId = c.get('userId');
  if (userId) return `u:${userId}`;
  // Anonymous caller: fall back to Cloudflare's client-IP hint, never persisted.
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'local';
  return `a:${ip}`;
}

/**
 * The middleware itself. Bumps the caller's counter, always sets the
 * `X-RateLimit-*` headers so clients can self-throttle, and throws 429 once the
 * count crosses the limit.
 */
export const rateLimit = createMiddleware<AppEnv>(async (c, next) => {
  const now = Date.now();
  const windowMs = RATE_LIMIT.WINDOW_SECONDS * 1000;
  sweep(now);
  const key = keyFor(c);

  // Start a fresh window when there's no bucket yet, or the old one has rolled
  // over. Either way the counter restarts from zero for this window.
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count++;

  const remaining = Math.max(0, RATE_LIMIT.LIMIT - bucket.count);
  const resetSeconds = Math.ceil(bucket.resetAt / 1000);

  c.header('X-RateLimit-Limit', String(RATE_LIMIT.LIMIT));
  c.header('X-RateLimit-Remaining', String(remaining));
  c.header('X-RateLimit-Reset', String(resetSeconds));

  if (bucket.count > RATE_LIMIT.LIMIT) {
    // Tell the client exactly how many seconds until the window frees up, so a
    // well-behaved one can back off instead of hammering and eating more 429s.
    c.header('Retry-After', String(Math.max(0, resetSeconds - Math.floor(now / 1000))));
    throw errors.rateLimited();
  }

  await next();
});
