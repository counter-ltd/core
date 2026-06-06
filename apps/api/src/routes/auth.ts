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
import { db, users, deviceKeys, webauthnCredentials, eq, and, desc } from '@counter/db';
import { loadServerEnv } from '@counter/config/env';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  verifyEmailSchema,
  registerPublicKeySchema,
  requestPasswordResetSchema,
  confirmPasswordResetSchema,
  setPasswordSchema,
  passkeyRegisterVerifySchema,
  passkeyAuthVerifySchema,
  passkeyRenameSchema,
} from '@counter/types';
import type { AuthResponse, PasskeySummary } from '@counter/types';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import {
  buildRegistrationOptions,
  buildAuthenticationOptions,
  storeChallenge,
  consumeChallenge,
  verifyRegistration,
  verifyAuthentication,
  extractChallenge,
} from '../lib/webauthn.ts';
import { body } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import {
  hashPassword,
  verifyPassword,
  issueTokens,
  rotateTokens,
  revokeByRefreshToken,
} from '../lib/auth.ts';
import { blindIndex, encryptField, decryptField } from '../lib/crypto.ts';
import {
  issueEmailVerification,
  consumeEmailVerification,
  verificationCooldownRemaining,
} from '../lib/verify.ts';
import {
  issuePasswordReset,
  consumePasswordReset,
  resetCooldownRemaining,
} from '../lib/passwordreset.ts';
import {
  sendVerificationEmail,
  sendDeletionConfirmation,
  sendPasswordResetEmail,
} from '../lib/email.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import { getPrivateUser, findUserByIdentifier } from '../services/userquery.ts';
import type { AppEnv } from '../types.ts';
import type { Context } from 'hono';

export const authRoutes = new Hono<AppEnv>();

/**
 * Issue a verification token and email the link.
 *
 * Guarded on the EMAIL binding so local dev (and any deploy that hasn't onboarded
 * the sending domain) simply skips it; the account is fully usable unverified.
 *
 * The token is written synchronously (awaited) so its row anchors the resend
 * rate limit before we respond, which closes the double-click race. Only the
 * actual send is deferred under waitUntil and best-effort, so a mail problem
 * never blocks the register/resend response that triggered it.
 */
async function fireVerificationEmail(
  c: Context<AppEnv>,
  user: { id: string; email: string; displayName: string | null; username: string },
): Promise<void> {
  if (!c.env.EMAIL) return;
  const email = c.env.EMAIL;
  const webUrl = c.env.PUBLIC_WEB_URL ?? 'https://counter.ltd';
  const name = user.displayName || user.username;
  let token: string;
  try {
    token = await issueEmailVerification(user.id);
  } catch {
    return; // Couldn't record the token; skip the send rather than orphan a link.
  }
  c.executionCtx.waitUntil(
    sendVerificationEmail(email, user.email, name, `${webUrl}/verify?token=${token}`).catch(() => {
      // Best effort: the user can always resend from settings.
    }),
  );
}

/**
 * Issue a reset token and email the link, returning the raw token to the caller.
 *
 * Shared by the public "forgot password" flow and the admin "email a reset"
 * action. The token is written synchronously (awaited) so its row anchors the
 * cooldown before we respond; only the send itself is deferred and best-effort,
 * so a mail hiccup never fails the request that triggered it. Returns the raw
 * token so an admin path can also surface it as a copyable link, or null if the
 * token couldn't be recorded.
 *
 * @param user  The target, carrying the already-decrypted plaintext address.
 * @returns     The raw token, or null if issuing it failed.
 */
async function fireResetEmail(
  c: Context<AppEnv>,
  user: { id: string; email: string; displayName: string | null; username: string },
): Promise<string | null> {
  const webUrl = c.env.PUBLIC_WEB_URL ?? 'https://counter.ltd';
  const name = user.displayName || user.username;
  let token: string;
  try {
    token = await issuePasswordReset(user.id);
  } catch {
    return null; // Couldn't record the token; don't orphan a link.
  }
  // Guarded on the binding so local dev (no EMAIL bound) still issues the token,
  // which keeps the admin "generate link" path working without a mail provider.
  if (c.env.EMAIL) {
    const email = c.env.EMAIL;
    c.executionCtx.waitUntil(
      sendPasswordResetEmail(email, user.email, name, `${webUrl}/reset-password?token=${token}`).catch(
        () => {
          // Best effort: the user can ask for another from the login page.
        },
      ),
    );
  }
  return token;
}

/**
 * Block a banned or actively-suspended account from signing in.
 *
 * A ban is permanent and always rejects. A suspension rejects only while its
 * `suspendedUntil` is still in the future; once that passes, the account is
 * quietly flipped back to 'active' and allowed through, so suspensions expire on
 * their own without an admin having to lift them. Throws a 403 when access is
 * denied; returns normally when the caller may proceed.
 */
async function enforceModerationStatus(row: {
  id: string;
  status: string;
  statusReason: string | null;
  suspendedUntil: Date | null;
}): Promise<void> {
  if (row.status === 'banned') {
    throw errors.forbidden(
      row.statusReason
        ? `Your account has been banned: ${row.statusReason}`
        : 'Your account has been banned.',
    );
  }
  if (row.status === 'suspended') {
    const until = row.suspendedUntil;
    if (until && until.getTime() > Date.now()) {
      throw errors.forbidden(
        row.statusReason
          ? `Your account is suspended until ${until.toISOString()}: ${row.statusReason}`
          : `Your account is suspended until ${until.toISOString()}.`,
      );
    }
    // The suspension has lapsed (or had no expiry recorded); reactivate and let
    // the login continue.
    await db
      .update(users)
      .set({ status: 'active', statusReason: null, suspendedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, row.id));
  }
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

  // Email is encrypted at rest, so the duplicate check matches on its blind
  // index, not the ciphertext column.
  const loweredEmail = input.email.toLowerCase();
  const env = loadServerEnv();
  const emailIndex = await blindIndex(loweredEmail, env.BLIND_INDEX_KEY);
  const emailTaken = await db.query.users.findFirst({
    where: eq(users.emailIndex, emailIndex),
  });
  if (emailTaken) throw errors.conflict('That email is already registered');

  const passwordHash = await hashPassword(input.password);
  const [created] = await db
    .insert(users)
    .values({
      username: input.username,
      email: await encryptField(loweredEmail, env.MESSAGE_ENCRYPTION_KEY),
      emailIndex,
      passwordHash,
      displayName: input.displayName ?? null,
    })
    .returning();
  if (!created) throw errors.internal('Failed to create account');

  // Send the "verify your email" link on the way out. It's optional and earns
  // only the ✦ badge, so it never blocks signup; the send itself is deferred and
  // skips cleanly when no mail binding is configured. Pass the plain-text address
  // we already have rather than the now-encrypted column on `created`.
  await fireVerificationEmail(c, { ...created, email: loweredEmail });

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
  // passwordHash is null for OAuth-only accounts. Fail the same way as a wrong
  // password so callers can't distinguish the two cases.
  if (!row || !row.passwordHash || !(await verifyPassword(input.password, row.passwordHash))) {
    throw errors.unauthorized('Invalid credentials');
  }

  // Moderation gate. A ban is indefinite; a suspension lifts itself once its
  // expiry passes, so a lapsed suspension auto-reactivates here rather than
  // needing an admin to clear it. Both rejections come after the password check
  // so they can't be used to probe which accounts exist.
  await enforceModerationStatus(row);

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

// Resend the verification email to the signed-in user. Two guards: already
// verified is a quiet no-op (nothing to do), and a rate limit of one email per
// hour per account, so the resend button can't be used to flood an inbox or run
// up the mail bill. Going over returns 429 with how long to wait.
authRoutes.post('/verify/request', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!row || row.verified) return c.json({ ok: true });

  const wait = await verificationCooldownRemaining(userId);
  if (wait > 0) {
    const mins = Math.ceil(wait / 60_000);
    throw errors.rateLimited(
      `You already requested one recently. Try again in about ${mins} minute${mins === 1 ? '' : 's'}.`,
    );
  }

  // row.email is ciphertext; the mailer needs the real address.
  const email = await decryptField(row.email, loadServerEnv().MESSAGE_ENCRYPTION_KEY);
  await fireVerificationEmail(c, { ...row, email });
  return c.json({ ok: true });
});

// --- password reset ---

// Start a password reset from the login page. Public: the only input is an
// email. The response is the same {ok:true} whether or not the address matches
// an account, so this can't be used to probe which emails are registered. A
// real match (that isn't past its cooldown) gets a reset link mailed out of
// band; everything else just returns ok and does nothing.
authRoutes.post('/password-reset/request', async (c) => {
  const input = await body(c, requestPasswordResetSchema);

  // Email is encrypted at rest, so the lookup matches on its blind index, not
  // the ciphertext column.
  const lowered = input.email.toLowerCase();
  const env = loadServerEnv();
  const emailIndex = await blindIndex(lowered, env.BLIND_INDEX_KEY);
  const row = await db.query.users.findFirst({ where: eq(users.emailIndex, emailIndex) });

  // Send only for a real account that's off cooldown. The cooldown is what stops
  // the endpoint being used to flood an inbox; staying silent about both the
  // miss and the throttle is what keeps the response uniform.
  if (row && (await resetCooldownRemaining(row.id)) === 0) {
    await fireResetEmail(c, { ...row, email: lowered });
  }
  return c.json({ ok: true });
});

// Complete a reset: redeem the token from the email and set the new password.
// Public, the token in the body is the credential, so it works even if the
// session that requested it has long expired. Redeeming also drops every session
// for the account, so the reset itself logs all devices out. A bad or expired
// token returns a plain 400 without leaking whether it ever existed.
authRoutes.post('/password-reset/confirm', async (c) => {
  const input = await body(c, confirmPasswordResetSchema);
  const ok = await consumePasswordReset(input.token, input.password);
  if (!ok) throw errors.validation('That reset link is invalid or has expired.');
  return c.json({ ok: true });
});

// Set or change the signed-in user's password. Two paths share one handler: an
// account that already has a password must prove the current one before changing
// it, while an OAuth-only account (passwordHash null) is setting its first
// password and has nothing to prove. Unlike a reset, this keeps every other
// session alive: the user knows their own current state, so there's no reason to
// boot their other devices.
authRoutes.post('/password', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, setPasswordSchema);

  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!row) throw errors.notFound('User not found');

  // Only gate on the current password when one exists. The same 401 covers a
  // missing and a wrong current password, so the response doesn't distinguish
  // "you forgot to send it" from "it was wrong".
  if (row.passwordHash) {
    if (!input.currentPassword || !(await verifyPassword(input.currentPassword, row.passwordHash))) {
      throw errors.unauthorized('Current password is incorrect');
    }
  }

  const passwordHash = await hashPassword(input.newPassword);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
  return c.json({ ok: true });
});

// --- passkeys (WebAuthn) ---

// Start enrolling a passkey for the signed-in user. Returns the creation options
// the browser feeds to navigator.credentials.create, and stashes the challenge
// so the verify step can confirm the browser signed the value we issued.
authRoutes.post('/passkeys/register/options', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!row) throw errors.notFound('User not found');
  const options = await buildRegistrationOptions({
    id: row.id,
    username: row.username,
    displayName: row.displayName,
  });
  await storeChallenge(options.challenge, 'registration', userId);
  return c.json(options);
});

// Finish enrolling a passkey. The challenge is recovered from the attestation's
// clientDataJSON and consumed (one-time) before verification, so a replayed or
// expired ceremony is rejected. On success the credential's public key and
// counter are stored; we never keep anything that could impersonate the device.
authRoutes.post('/passkeys/register/verify', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, passkeyRegisterVerifySchema);
  const response = input.response as unknown as RegistrationResponseJSON;

  const challenge = extractChallenge(response);
  await consumeChallenge(challenge, 'registration');
  const reg = await verifyRegistration(response, challenge);

  await db.insert(webauthnCredentials).values({
    userId,
    credentialId: reg.credentialId,
    publicKey: reg.publicKey,
    counter: reg.counter,
    transports: reg.transports,
    deviceType: reg.deviceType,
    backedUp: reg.backedUp,
    nickname: input.nickname ?? null,
  });
  return c.json({ ok: true });
});

// Start a passwordless login. Public: the caller isn't authenticated yet. The
// options carry no allowCredentials, so the browser offers any discoverable
// passkey for this site and the account is resolved from whichever one signs.
authRoutes.post('/passkeys/authenticate/options', async (c) => {
  const options = await buildAuthenticationOptions();
  await storeChallenge(options.challenge, 'authentication');
  return c.json(options);
});

// Finish a passwordless login. Verifies the assertion against the issued
// challenge, resolves the user from the signing credential, runs the same
// moderation gate as password login, then issues a normal token pair. A counter
// regression (cloned-authenticator signal) fails verification inside the lib.
authRoutes.post('/passkeys/authenticate/verify', async (c) => {
  const input = await body(c, passkeyAuthVerifySchema);
  const response = input.response as unknown as AuthenticationResponseJSON;

  const challenge = extractChallenge(response);
  await consumeChallenge(challenge, 'authentication');
  const { userId } = await verifyAuthentication(response, challenge);

  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  // A passkey whose owner was hard-deleted shouldn't resolve, but fail uniformly
  // rather than leaking that the credential is orphaned.
  if (!row) throw errors.unauthorized('Invalid credentials');
  await enforceModerationStatus(row);

  const tokens = await issueTokens(userId);
  const user = await getPrivateUser(userId);
  return c.json<AuthResponse>({ ...tokens, user });
});

// List the caller's passkeys for the settings screen. Public key and counter are
// deliberately omitted; only the label and timestamps a person needs to tell
// their passkeys apart.
authRoutes.get('/passkeys', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const rows = await db
    .select({
      id: webauthnCredentials.id,
      nickname: webauthnCredentials.nickname,
      createdAt: webauthnCredentials.createdAt,
      lastUsedAt: webauthnCredentials.lastUsedAt,
      deviceType: webauthnCredentials.deviceType,
    })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId))
    .orderBy(desc(webauthnCredentials.createdAt));
  return c.json<PasskeySummary[]>(
    rows.map((r) => ({
      id: r.id,
      nickname: r.nickname,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      deviceType: r.deviceType,
    })),
  );
});

// Relabel a passkey. Scoped to the caller's own rows, so an id from someone
// else's account matches nothing and 404s rather than touching their data.
authRoutes.patch('/passkeys/:id', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const input = await body(c, passkeyRenameSchema);
  const updated = await db
    .update(webauthnCredentials)
    .set({ nickname: input.nickname })
    .where(and(eq(webauthnCredentials.id, id), eq(webauthnCredentials.userId, userId)))
    .returning({ id: webauthnCredentials.id });
  if (!updated.length) throw errors.notFound('Passkey not found');
  return c.json({ ok: true });
});

// Remove a passkey. Scoped to the caller's rows for the same reason as rename.
authRoutes.delete('/passkeys/:id', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  await db
    .delete(webauthnCredentials)
    .where(and(eq(webauthnCredentials.id, id), eq(webauthnCredentials.userId, userId)));
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

// List all device keys registered for the caller. Clients fetch this on page
// load to know which of their own devices will receive copies of outgoing
// messages, and to display the "you have unregistered devices" warning.
authRoutes.get('/keys', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const rows = await db
    .select({ deviceId: deviceKeys.deviceId, publicKey: deviceKeys.publicKey })
    .from(deviceKeys)
    .where(eq(deviceKeys.userId, userId));
  return c.json({ keys: rows });
});

// Register or rotate the E2EE key for one specific device. Clients call this
// once per device on first use. The upsert on (userId, deviceId) means
// re-registering the same device (e.g. after a key rotation) updates the row
// rather than duplicating it.
authRoutes.post('/keys', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, registerPublicKeySchema);
  await db
    .insert(deviceKeys)
    .values({ userId, deviceId: input.deviceId, publicKey: input.publicKey })
    .onConflictDoUpdate({
      target: [deviceKeys.userId, deviceKeys.deviceId],
      set: { publicKey: input.publicKey },
    });
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
    // Stored encrypted; decrypt the address so the confirmation has somewhere to go.
    const email = await decryptField(row.email, loadServerEnv().MESSAGE_ENCRYPTION_KEY);
    c.executionCtx.waitUntil(
      sendDeletionConfirmation(c.env.EMAIL, email, name).catch(() => {
        // Already deleted; nothing to recover. Don't surface a mail error.
      }),
    );
  }
  return c.json({ ok: true });
});
