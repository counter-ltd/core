// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Email-verification tokens: issuing one and redeeming it.
 *
 * The shape mirrors sessions, store only the SHA-256 of a high-entropy random
 * token, never the token itself, so a database leak can't be replayed to verify
 * someone's address. Redeeming flips users.verified, which is the whole reward:
 * the ✦ badge. It deliberately gates nothing, so it stays clear of the CSL's
 * ban on engagement and threshold gates.
 */
import { db, emailVerifications, users, eq } from '@counter/db';
import { sha256Hex } from './crypto.ts';

// 24 hours. Long enough that a link in an inbox still works the next day, short
// enough that a leaked-but-stale token is useless.
const TTL_MS = 24 * 60 * 60 * 1000;

// One verification email per hour per account. Anchored in the DB (the latest
// token's createdAt), not in isolate memory, so it holds exactly across Workers
// isolates, where an in-memory counter wouldn't, and it's email we're spending.
const RESEND_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * How long until this user may be sent another verification email.
 *
 * Reads the most recent token's age (issuing replaces the prior token, so that's
 * the last-send time). Returns 0 when there's no recent send and a fresh email
 * is allowed now.
 *
 * @param userId  Who's asking for a (re)send.
 * @returns       Milliseconds to wait, or 0 if allowed immediately.
 */
export async function verificationCooldownRemaining(userId: string): Promise<number> {
  const recent = await db.query.emailVerifications.findFirst({
    where: eq(emailVerifications.userId, userId),
    orderBy: (v, { desc }) => desc(v.createdAt),
  });
  if (!recent) return 0;
  return Math.max(0, RESEND_COOLDOWN_MS - (Date.now() - recent.createdAt.getTime()));
}

/** A 256-bit random token as lowercase hex, safe to put in a URL. */
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Issue a verification token for a user and return the raw token for emailing.
 *
 * Any earlier pending tokens for the user are cleared first, so only the newest
 * link works (clicking "resend" invalidates the old email).
 *
 * @param userId  Who the token verifies.
 * @returns       The raw token; only its hash is stored.
 */
export async function issueEmailVerification(userId: string): Promise<string> {
  const token = randomToken();
  await db.delete(emailVerifications).where(eq(emailVerifications.userId, userId));
  await db.insert(emailVerifications).values({
    userId,
    tokenHash: await sha256Hex(token),
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  return token;
}

/**
 * Redeem a verification token: mark the user verified and burn the token.
 *
 * Fails closed, an unknown or expired token just returns false, so a stale link
 * reads as "didn't work" rather than throwing. Expired rows are cleaned up on
 * the way out.
 *
 * @param token  The raw token from the verify link.
 * @returns      true if it verified an account, false otherwise.
 */
export async function consumeEmailVerification(token: string): Promise<boolean> {
  const row = await db.query.emailVerifications.findFirst({
    where: eq(emailVerifications.tokenHash, await sha256Hex(token)),
  });
  if (!row) return false;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(emailVerifications).where(eq(emailVerifications.id, row.id));
    return false;
  }
  await db.update(users).set({ verified: true }).where(eq(users.id, row.userId));
  // One token per verification: clear all of this user's pending tokens so the
  // link can't be replayed.
  await db.delete(emailVerifications).where(eq(emailVerifications.userId, row.userId));
  return true;
}
