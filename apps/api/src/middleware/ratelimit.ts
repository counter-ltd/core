import { createMiddleware } from 'hono/factory';
import { RATE_LIMIT } from '@counter/config';
import { errors } from '../lib/errors.ts';
import type { AppEnv } from '../types.ts';

/**
 * A fixed-window in-memory rate limiter. Keyed by authenticated user id when
 * available, otherwise the Cloudflare-provided client IP hint. Counter never
 * logs IPs to storage — this key lives only in isolate memory and is never
 * persisted.
 *
 * NOTE: On Workers this is per-isolate, so the limit is approximate under load
 * (each isolate counts independently). For strict global limits, swap this for a
 * Durable Object or the Workers Rate Limiting binding — the `X-RateLimit-*`
 * header contract below stays identical either way.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Opportunistic eviction (no global timers — those are disallowed on Workers). */
function sweep(now: number): void {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function keyFor(c: { get: (k: 'userId') => string | undefined; req: { header: (n: string) => string | undefined } }): string {
  const userId = c.get('userId');
  if (userId) return `u:${userId}`;
  // Anonymous: best-effort grouping via Cloudflare's client-IP hint. Not stored.
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'local';
  return `a:${ip}`;
}

export const rateLimit = createMiddleware<AppEnv>(async (c, next) => {
  const now = Date.now();
  const windowMs = RATE_LIMIT.WINDOW_SECONDS * 1000;
  sweep(now);
  const key = keyFor(c);

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
    c.header('Retry-After', String(Math.max(0, resetSeconds - Math.floor(now / 1000))));
    throw errors.rateLimited();
  }

  await next();
});

// Eviction is handled opportunistically in sweep() above — Workers disallow
// timers (setInterval) at module/global scope.
