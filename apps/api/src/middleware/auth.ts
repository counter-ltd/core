// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The middleware that turns a Bearer token into a `userId` on the request.
 *
 * It comes in two flavours. `optionalAuth` reads the token if there is one and
 * shrugs if there isn't, so public endpoints serve both logged-in and anonymous
 * callers from the same handler. `requireAuth` is the gate you bolt onto routes
 * that genuinely need a user, and it 401s when the id is missing.
 *
 * The split matters: `optionalAuth` runs everywhere up front to populate the
 * context, and `requireAuth` only checks what it left behind.
 */
import { createMiddleware } from 'hono/factory';
import { verifyAccessToken } from '../lib/jwt.ts';
import { errors } from '../lib/errors.ts';
import type { AppEnv } from '../types.ts';

/**
 * Read a Bearer access token if present and stash the userId on the context.
 *
 * This never rejects. A request with a bad or expired token is treated exactly
 * like one with no token at all, so a stale token sitting in an old client can't
 * turn a public read into a 401.
 */
export const optionalAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    try {
      const { userId } = await verifyAccessToken(token);
      c.set('userId', userId);
    } catch {
      // Bad token, so we just fall through as an anonymous request.
    }
  }
  await next();
});

/**
 * Gate a route on having a logged-in user. Relies on `optionalAuth` having run
 * earlier in the chain to set `userId`; if it didn't land, the request is
 * anonymous and gets a 401.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('userId')) throw errors.unauthorized();
  await next();
});

/**
 * Pull the authenticated user id out of a handler, or 401 if there isn't one.
 *
 * Use this inside `requireAuth`-protected handlers so the id reads as a plain
 * `string` instead of `string | undefined`. It re-checks rather than trusting
 * the middleware so the non-null type is actually earned, not asserted.
 */
export function requireUserId(c: { get: (k: 'userId') => string | undefined }): string {
  const id = c.get('userId');
  if (!id) throw errors.unauthorized();
  return id;
}
