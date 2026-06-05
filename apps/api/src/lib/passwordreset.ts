// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Password-reset tokens: issuing one, redeeming it for a new password, and the
 * per-account cooldown that keeps the request endpoint from being used to flood
 * an inbox.
 *
 * Same shape as email verification (lib/verify.ts): only the SHA-256 of a
 * high-entropy random token is stored, never the token itself, so a database
 * leak can't be replayed to seize an account. Two deliberate differences: the
 * TTL is one hour rather than 24 (a reset link is a far more dangerous
 * credential), and redeeming rewrites the password and tears down every live
 * session so a thief who already had the old password is locked out.
 */
import { db, passwordResets, users, sessions, eq } from '@counter/db';
import { sha256Hex, hashPassword } from './crypto.ts';

// One hour. A reset link sitting in an inbox is the keys to the account, so it
// expires fast; long enough to click through from the email that prompted it,
// short enough that a leaked-but-stale link is useless.
const TTL_MS = 60 * 60 * 1000;

// One reset email per 15 minutes per account. Anchored in the DB (the latest
// token's createdAt), not isolate memory, so it holds across Workers isolates
// where an in-memory counter wouldn't, and it's email we're spending.
const RESEND_COOLDOWN_MS = 15 * 60 * 1000;

/** A 256-bit random token as lowercase hex, safe to put in a URL. */
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * How long until this user may be sent another reset email.
 *
 * Reads the most recent token's age (issuing replaces the prior token, so that's
 * the last-send time). Returns 0 when a fresh email is allowed now.
 *
 * @param userId  Who's asking for a (re)send.
 * @returns       Milliseconds to wait, or 0 if allowed immediately.
 */
export async function resetCooldownRemaining(userId: string): Promise<number> {
  const recent = await db.query.passwordResets.findFirst({
    where: eq(passwordResets.userId, userId),
    orderBy: (r, { desc }) => desc(r.createdAt),
  });
  if (!recent) return 0;
  return Math.max(0, RESEND_COOLDOWN_MS - (Date.now() - recent.createdAt.getTime()));
}

/**
 * Issue a reset token for a user and return the raw token for the link.
 *
 * Any earlier pending tokens for the user are cleared first, so only the newest
 * link works. That also means an admin re-issuing a link silently voids one a
 * user may have requested moments earlier, which is the safe direction.
 *
 * @param userId  Whose password the token will reset.
 * @returns       The raw token; only its hash is stored.
 */
export async function issuePasswordReset(userId: string): Promise<string> {
  const token = randomToken();
  await db.delete(passwordResets).where(eq(passwordResets.userId, userId));
  await db.insert(passwordResets).values({
    userId,
    tokenHash: await sha256Hex(token),
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  return token;
}

/**
 * Redeem a reset token: set the new password, burn the token, and log the user
 * out everywhere.
 *
 * Fails closed. An unknown or expired token returns false (a stale link reads as
 * "didn't work" rather than throwing), and expired rows are cleaned up on the
 * way out. On success every session is dropped: the password just changed out
 * from under anyone holding the old one, including whoever may have triggered
 * the reset, so a fresh login is required.
 *
 * @param token        The raw token from the reset link.
 * @param newPassword  The already-validated plaintext to hash and store.
 * @returns            true if a password was reset, false for a bad/expired token.
 */
export async function consumePasswordReset(token: string, newPassword: string): Promise<boolean> {
  const row = await db.query.passwordResets.findFirst({
    where: eq(passwordResets.tokenHash, await sha256Hex(token)),
  });
  if (!row) return false;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(passwordResets).where(eq(passwordResets.id, row.id));
    return false;
  }

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, row.userId));
  // One token per reset: clear all of this user's pending tokens so the link
  // can't be replayed.
  await db.delete(passwordResets).where(eq(passwordResets.userId, row.userId));
  // The password changed, so every existing session is now suspect. Drop them
  // all and force a fresh login on every device.
  await db.delete(sessions).where(eq(sessions.userId, row.userId));
  return true;
}
