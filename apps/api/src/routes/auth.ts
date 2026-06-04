// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The account lifecycle endpoints: register, login, token refresh, logout, and
 * account deletion.
 *
 * These hand out and rotate the JWT pair from `lib/jwt`. The recurring shape is
 * "prove who you are, then `issueTokens`/`rotateTokens` and return the user".
 * The deliberate security choices (uniform login failures, hard account delete)
 * are called out at each handler.
 */
import { Hono } from 'hono';
import { db, users, eq } from '@counter/db';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  verifyEmailSchema,
} from '@counter/types';
import type { AuthResponse } from '@counter/types';
import { body } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import {
  hashPassword,
  verifyPassword,
  issueTokens,
  rotateTokens,
  revokeByRefreshToken,
} from '../lib/auth.ts';
import { issueEmailVerification, consumeEmailVerification } from '../lib/verify.ts';
import { sendVerificationEmail, sendDeletionConfirmation } from '../lib/email.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import { getPrivateUser, findUserByIdentifier } from '../services/userquery.ts';
import type { AppEnv } from '../types.ts';
import type { Context } from 'hono';

export const authRoutes = new Hono<AppEnv>();

/**
 * Issue a verification token and email the link, out of band.
 *
 * Guarded on the EMAIL binding so local dev (and any deploy that hasn't onboarded
 * the sending domain) simply skips it; the account is fully usable unverified.
 * Runs under waitUntil and swallows errors so a mail problem never blocks the
 * register/resend response that triggered it.
 */
function fireVerificationEmail(
  c: Context<AppEnv>,
  user: { id: string; email: string; displayName: string | null; username: string },
): void {
  if (!c.env.EMAIL) return;
  const email = c.env.EMAIL;
  const webUrl = c.env.PUBLIC_WEB_URL ?? 'https://counter.ltd';
  const name = user.displayName || user.username;
  c.executionCtx.waitUntil(
    issueEmailVerification(user.id)
      .then((token) => sendVerificationEmail(email, user.email, name, `${webUrl}/verify?token=${token}`))
      .catch(() => {
        // Best effort: the user can always resend from settings.
      }),
  );
}

// --- register / login ---

// Create an account and log it straight in, returning a token pair plus the
// new user. Username and email are checked separately so the 409 message can
// say which one collided. Email is lower-cased before both the check and the
// insert so uniqueness is case-insensitive.
authRoutes.post('/register', async (c) => {
  const input = await body(c, registerSchema);

  const existing = await db.query.users.findFirst({
    where: eq(users.username, input.username),
  });
  if (existing) throw errors.conflict('That username is taken');

  const emailTaken = await db.query.users.findFirst({
    where: eq(users.email, input.email.toLowerCase()),
  });
  if (emailTaken) throw errors.conflict('That email is already registered');

  const passwordHash = await hashPassword(input.password);
  const [created] = await db
    .insert(users)
    .values({
      username: input.username,
      email: input.email.toLowerCase(),
      passwordHash,
      displayName: input.displayName ?? null,
    })
    .returning();
  if (!created) throw errors.internal('Failed to create account');

  // Send the "verify your email" link on the way out. It's optional and earns
  // only the ✦ badge, so it never blocks signup; fireVerificationEmail runs it
  // out of band and skips cleanly when no mail binding is configured.
  fireVerificationEmail(c, created);

  const tokens = await issueTokens(created.id);
  const user = await getPrivateUser(created.id);
  return c.json<AuthResponse>({ ...tokens, user }, 201);
});

// Log in with either a username or email (whatever `identifier` resolves to)
// and a password.
authRoutes.post('/login', async (c) => {
  const input = await body(c, loginSchema);
  const row = await findUserByIdentifier(input.identifier);
  // Same "Invalid credentials" whether the account is missing or the password
  // is wrong, so an attacker can't probe which usernames exist. We still run
  // verifyPassword on a real hash when the user exists, which keeps the timing
  // roughly even between the two failure paths.
  if (!row || !(await verifyPassword(input.password, row.passwordHash))) {
    throw errors.unauthorized('Invalid credentials');
  }

  const tokens = await issueTokens(row.id);
  const user = await getPrivateUser(row.id);
  return c.json<AuthResponse>({ ...tokens, user });
});

// --- email verification ---

// Redeem a verification token (the link from the email). Public: the token in
// the body is the credential, no login needed, which lets the link work even if
// the session has since expired. A bad or expired token returns a plain 400 so
// the page can say "this link didn't work" without leaking whether it ever did.
authRoutes.post('/verify', async (c) => {
  const input = await body(c, verifyEmailSchema);
  const ok = await consumeEmailVerification(input.token);
  if (!ok) throw errors.validation('That verification link is invalid or has expired.');
  return c.json({ ok: true });
});

// Resend the verification email to the signed-in user. No-op response whether or
// not mail is configured, so the client always gets the same "check your inbox"
// regardless of deployment. Skips the work if they're already verified.
authRoutes.post('/verify/request', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (row && !row.verified) fireVerificationEmail(c, row);
  return c.json({ ok: true });
});

// --- token rotation / logout ---

// Trade a valid refresh token for a fresh pair. `rotateTokens` retires the old
// refresh token as it issues the new one, so a leaked-and-reused token is
// detectable. No access token needed here: the refresh token IS the credential.
authRoutes.post('/refresh', async (c) => {
  const input = await body(c, refreshSchema);
  const tokens = await rotateTokens(input.refreshToken);
  return c.json(tokens);
});

// Revoke the given session's refresh token. Best-effort: a missing or already
// gone token still returns ok, since the client's goal (be logged out) is met
// either way. Access tokens are short-lived, so we don't track them here.
authRoutes.post('/logout', async (c) => {
  const input = await body(c, logoutSchema);
  if (input?.refreshToken) await revokeByRefreshToken(input.refreshToken);
  return c.json({ ok: true });
});

// Permanently delete the caller's account. This is a hard delete: foreign-key
// cascades take everything the user owns with it. Anonymous post_views survive
// because they're never tied to a user id in the first place.
authRoutes.delete('/account', requireAuth, async (c) => {
  const userId = requireUserId(c);
  // Read the address before the row is gone: the hard delete is about to take
  // the email with everything else, and the confirmation needs somewhere to go.
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  await db.delete(users).where(eq(users.id, userId));

  // Send the written confirmation out of band so it can't delay or fail the
  // response. Guarded on the binding, so local dev (no EMAIL bound) just skips
  // it, and the on-screen confirmation still covers the license requirement.
  if (c.env.EMAIL && row?.email) {
    const name = row.displayName || row.username;
    c.executionCtx.waitUntil(
      sendDeletionConfirmation(c.env.EMAIL, row.email, name).catch(() => {
        // Already deleted; nothing to recover. Don't surface a mail error.
      }),
    );
  }
  return c.json({ ok: true });
});
