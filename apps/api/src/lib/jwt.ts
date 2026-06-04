// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Signing and verification for the JSON Web Tokens that power login.
 *
 * Two kinds of token are in play. The access token is short-lived and gets
 * sent on every request to prove who you are. The refresh token lives much
 * longer and has exactly one job: handing it in gets you a fresh access token
 * once the old one expires. Crucially, each kind is signed with its OWN secret,
 * so if one secret ever leaks an attacker still can't forge the other kind.
 */
import { sign, verify } from 'hono/jwt';
import { loadServerEnv } from '@counter/config/env';
import { parseDuration } from './duration.ts';
import { errors } from './errors.ts';

// We look the config up through a function call instead of reading it once at
// the top of the file. On Cloudflare Workers the secrets don't exist until the
// first request arrives, so grabbing them at import time would read undefined.
const cfg = () => loadServerEnv();

// How long each token stays valid, in seconds. These are functions for the
// same reason as cfg() above: the values come from env, which isn't ready yet.
export const accessTtlSeconds = () => parseDuration(cfg().JWT_EXPIRES_IN);
export const refreshTtlSeconds = () => parseDuration(cfg().JWT_REFRESH_EXPIRES_IN);

/** The claims baked into an access token. `sub` is the user it belongs to. */
interface AccessPayload {
  sub: string;
  type: 'access';
  exp: number;
  [key: string]: unknown;
}

/** The claims baked into a refresh token. `sid` ties it to one login session. */
interface RefreshPayload {
  sub: string;
  sid: string;
  /**
   * A fresh random id stamped on every refresh token. We rotate these tokens
   * on each use, and the jti is what makes the replacement token come out
   * different from the one it retired, even when every other claim matches.
   */
  jti: string;
  type: 'refresh';
  exp: number;
  [key: string]: unknown;
}

// JWT expiry is counted in whole seconds since 1970, not milliseconds.
const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Mint a signed access token for a user.
 *
 * @param userId  Who the token will authenticate.
 * @returns       The signed JWT, ready to send to the client.
 */
export async function signAccessToken(userId: string): Promise<string> {
  const payload: AccessPayload = {
    sub: userId,
    type: 'access',
    exp: nowSeconds() + accessTtlSeconds(),
  };
  return sign(payload, cfg().JWT_SECRET, 'HS256');
}

/**
 * Mint a signed refresh token tied to a specific login session.
 *
 * @param userId     Who the token belongs to.
 * @param sessionId  The session this token can refresh, so we can revoke one
 *                   session without touching the user's others.
 * @returns          The signed JWT, ready to store and hand back later.
 */
export async function signRefreshToken(userId: string, sessionId: string): Promise<string> {
  const payload: RefreshPayload = {
    sub: userId,
    sid: sessionId,
    jti: crypto.randomUUID(),
    type: 'refresh',
    exp: nowSeconds() + refreshTtlSeconds(),
  };
  return sign(payload, cfg().JWT_REFRESH_SECRET, 'HS256');
}

/**
 * Check an access token and pull the user id back out.
 *
 * We verify the signature first, then double-check the `type` claim so a
 * refresh token can't be smuggled in where an access token is expected. Any
 * failure (bad signature, expired, wrong type) collapses into one 401 so we
 * never leak which part went wrong.
 *
 * @param token  The raw JWT string from the request.
 * @returns      The id of the authenticated user.
 */
export async function verifyAccessToken(token: string): Promise<{ userId: string }> {
  try {
    const payload = (await verify(token, cfg().JWT_SECRET, 'HS256')) as unknown as AccessPayload;
    if (payload.type !== 'access') throw new Error('wrong token type');
    return { userId: payload.sub };
  } catch {
    throw errors.unauthorized('Invalid or expired access token');
  }
}

/**
 * Check a refresh token and pull back both the user and which session it's for.
 *
 * Same shape as verifyAccessToken, but it insists on the `refresh` type and
 * also returns the session id so the caller can rotate that exact session.
 *
 * @param token  The raw JWT string presented at the refresh endpoint.
 * @returns      The user id and the session id the token refreshes.
 */
export async function verifyRefreshToken(
  token: string,
): Promise<{ userId: string; sessionId: string }> {
  try {
    const payload = (await verify(
      token,
      cfg().JWT_REFRESH_SECRET,
      'HS256',
    )) as unknown as RefreshPayload;
    if (payload.type !== 'refresh') throw new Error('wrong token type');
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    throw errors.unauthorized('Invalid or expired refresh token');
  }
}
