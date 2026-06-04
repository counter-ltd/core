// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The session lifecycle: issuing, rotating, and revoking the token pairs that
 * keep a user logged in.
 *
 * jwt.ts knows how to sign and verify tokens but nothing about sessions. This
 * file is the layer above it, pairing each refresh token with a row in the
 * `sessions` table so a token can be checked, rotated, or revoked server-side
 * rather than living purely in a stateless JWT.
 */
import { db, sessions, eq, and } from '@counter/db';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  accessTtlSeconds,
  refreshTtlSeconds,
} from './jwt.ts';
import { sha256Hex } from './crypto.ts';
import { errors } from './errors.ts';
import type { TokenPair } from '@counter/types';

// Re-exported here so callers reach for one auth module instead of importing
// password hashing straight from crypto.ts. The implementation is WebCrypto
// PBKDF2, which behaves the same on Workers and Bun.
export { hashPassword, verifyPassword } from './crypto.ts';

/**
 * Hash a refresh token for storage.
 *
 * We persist only this hash, never the token itself, so a database leak hands
 * an attacker hashes they can't replay as live tokens. A plain SHA-256 (not a
 * slow password hash) is enough here because the input is already a long random
 * JWT, not a guessable human secret.
 */
function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/**
 * Start a new login session and return its token pair.
 *
 * @param userId  The user logging in.
 * @returns       A fresh access + refresh pair; the refresh side is now backed
 *                by a `sessions` row that can later be rotated or revoked.
 */
export async function issueTokens(userId: string): Promise<TokenPair> {
  const sessionId = crypto.randomUUID();
  const refreshToken = await signRefreshToken(userId, sessionId);
  const expiresAt = new Date(Date.now() + refreshTtlSeconds() * 1000);

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash: await hashToken(refreshToken),
    expiresAt,
    lastUsedAt: new Date(),
  });

  const accessToken = await signAccessToken(userId);
  return { accessToken, refreshToken, expiresIn: accessTtlSeconds() };
}

/**
 * Trade a valid refresh token for a brand-new pair, retiring the old one.
 *
 * Each refresh rotates the stored hash, so a refresh token works exactly once.
 * If a stolen token gets used, the real user's next refresh fails the hash
 * check below and the theft surfaces instead of going unnoticed.
 *
 * @param refreshToken  The token presented at the refresh endpoint.
 * @returns             A new access + refresh pair on the same session.
 */
export async function rotateTokens(refreshToken: string): Promise<TokenPair> {
  const { userId, sessionId } = await verifyRefreshToken(refreshToken);

  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, sessionId), eq(sessions.userId, userId)),
  });

  if (!session) throw errors.unauthorized('Session no longer exists');
  // The signature already verified, so a hash mismatch means this is a real but
  // stale token: the session has since rotated to a newer one (or been revoked).
  if (session.tokenHash !== (await hashToken(refreshToken))) {
    throw errors.unauthorized('Refresh token has been rotated or revoked');
  }
  // Delete on expiry rather than leaving dead rows to accumulate; the JWT's own
  // exp would also reject it, but cleaning up keeps the table honest.
  if (session.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    throw errors.unauthorized('Session expired');
  }

  const newRefresh = await signRefreshToken(userId, sessionId);
  await db
    .update(sessions)
    .set({
      tokenHash: await hashToken(newRefresh),
      lastUsedAt: new Date(),
      expiresAt: new Date(Date.now() + refreshTtlSeconds() * 1000),
    })
    .where(eq(sessions.id, sessionId));

  const accessToken = await signAccessToken(userId);
  return { accessToken, refreshToken: newRefresh, expiresIn: accessTtlSeconds() };
}

/**
 * Log out one session by deleting the row its refresh token points at.
 *
 * Best-effort on purpose: logout should always look like it worked. If the
 * token won't even verify there's no session to delete, so we swallow the
 * error rather than make the client handle a failure they can't act on.
 *
 * @param refreshToken  The token from the client being logged out.
 */
export async function revokeByRefreshToken(refreshToken: string): Promise<void> {
  try {
    const { sessionId } = await verifyRefreshToken(refreshToken);
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  } catch {
    // An invalid or expired token can't refresh anything, so it's already as
    // good as revoked. Nothing to clean up.
  }
}

/**
 * Log a user out everywhere by dropping all their sessions at once.
 *
 * The hammer for "sign out all devices" and the safety net during account
 * deletion, where leaving live sessions behind would be a security hole.
 *
 * @param userId  The user whose sessions all get invalidated.
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
