import { createMiddleware } from 'hono/factory';
import { verifyAccessToken } from '../lib/jwt.ts';
import { errors } from '../lib/errors.ts';
import type { AppEnv } from '../types.ts';

/**
 * Reads a Bearer access token if present and attaches userId to the context.
 * Never rejects — public endpoints must work unauthenticated. An invalid token
 * is simply ignored (treated as anonymous) so a stale token never blocks public
 * reads.
 */
export const optionalAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    try {
      const { userId } = await verifyAccessToken(token);
      c.set('userId', userId);
    } catch {
      // Ignore — anonymous request.
    }
  }
  await next();
});

/** Requires a valid access token; throws 401 otherwise. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('userId')) throw errors.unauthorized();
  await next();
});

/** Convenience: get the authenticated user id or throw 401. */
export function requireUserId(c: { get: (k: 'userId') => string | undefined }): string {
  const id = c.get('userId');
  if (!id) throw errors.unauthorized();
  return id;
}
