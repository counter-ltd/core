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

// Password hashing lives in ./crypto.ts (WebCrypto PBKDF2) so it runs on both
// Workers and Bun. Re-export for callers.
export { hashPassword, verifyPassword } from './crypto.ts';

/** Refresh tokens are stored only as a SHA-256 hash, so a DB leak can't replay them. */
function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/** Create a fresh session row and return an access+refresh token pair. */
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
 * Validate a refresh token and rotate it: the old token is invalidated and a new
 * pair is issued on the same session row. Rotation limits the blast radius of a
 * stolen refresh token.
 */
export async function rotateTokens(refreshToken: string): Promise<TokenPair> {
  const { userId, sessionId } = await verifyRefreshToken(refreshToken);

  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, sessionId), eq(sessions.userId, userId)),
  });

  if (!session) throw errors.unauthorized('Session no longer exists');
  if (session.tokenHash !== (await hashToken(refreshToken))) {
    throw errors.unauthorized('Refresh token has been rotated or revoked');
  }
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

/** Revoke a single session by its refresh token (logout). Best-effort. */
export async function revokeByRefreshToken(refreshToken: string): Promise<void> {
  try {
    const { sessionId } = await verifyRefreshToken(refreshToken);
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  } catch {
    // An invalid/expired token is already effectively revoked.
  }
}

/** Revoke every session for a user (e.g. account deletion fallback). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
