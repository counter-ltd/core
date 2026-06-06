// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Passkey (WebAuthn) ceremonies: building the options the browser feeds to
 * `navigator.credentials`, persisting the one-time challenge, and verifying the
 * attestation/assertion that comes back.
 *
 * The signature verification is delegated to `@simplewebauthn/server`, which
 * runs on workerd and uses WebCrypto under the hood. Hand-rolling COSE/CBOR
 * parsing here would be a large, easy-to-get-wrong surface (a subtle bug is an
 * auth bypass), so we lean on the library and keep this file to glue: RP config,
 * challenge storage (mirroring oauthStates), and the DB reads/writes.
 *
 * Every base64url string (credential id, public key) is stored exactly as the
 * library hands it over. The standard-base64 helpers in crypto.ts are NOT
 * url-safe and would corrupt these values, so they're deliberately not used.
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { db, webauthnCredentials, webauthnChallenges, eq, and } from '@counter/db';
import { loadServerEnv } from '@counter/config/env';
import { errors } from './errors.ts';

// 5 minutes: long enough for the user to complete a Touch ID / security-key tap,
// short enough that a leaked challenge is useless by the time it's found. Matches
// the spirit of the OAuth session-code TTL.
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type Ceremony = 'registration' | 'authentication';

/** The relying-party identity every ceremony is bound to. */
interface RpConfig {
  rpID: string;
  rpName: string;
  origin: string;
}

/**
 * Relying-party config from the environment. The RP ID is the web origin's
 * registrable domain (not the API host), and the browser enforces that the page
 * running the ceremony matches it.
 */
function rpConfig(): RpConfig {
  const env = loadServerEnv();
  return { rpID: env.WEBAUTHN_RP_ID, rpName: env.WEBAUTHN_RP_NAME, origin: env.WEBAUTHN_ORIGIN };
}

/**
 * Build registration options for an authenticated user. Existing passkeys are
 * passed as `excludeCredentials` so the same authenticator can't be enrolled
 * twice, and resident keys are preferred so the credential is discoverable (that
 * is what makes usernameless login work later).
 *
 * @param user  The signed-in account enrolling a new passkey.
 */
export async function buildRegistrationOptions(user: {
  id: string;
  username: string;
  displayName: string | null;
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID, rpName } = rpConfig();
  const existing = await db
    .select({ credentialId: webauthnCredentials.credentialId, transports: webauthnCredentials.transports })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, user.id));

  return generateRegistrationOptions({
    rpName,
    rpID,
    // The user handle the authenticator stores. Bytes of our UUID, so a returned
    // userHandle round-trips back to the Counter id if we ever need it.
    userID: isoUint8Array.fromUTF8String(user.id),
    userName: user.username,
    userDisplayName: user.displayName ?? user.username,
    // We don't collect or verify attestation statements; 'none' keeps the
    // ceremony simple and avoids storing anything we won't check.
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: parseTransports(c.transports),
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });
}

/**
 * Build authentication options for login. `allowCredentials` is intentionally
 * empty: the user hasn't identified themselves yet, so we let the browser offer
 * any discoverable passkey for this RP and resolve the account from whichever
 * one signs.
 */
export async function buildAuthenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = rpConfig();
  return generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: [],
  });
}

/**
 * Persist a ceremony challenge so the verify step can confirm the browser signed
 * the value we issued. Mirrors `storeOAuthState`.
 *
 * @param challenge  The raw challenge string from the generated options.
 * @param ceremony   Which ceremony this nonce belongs to.
 * @param userId     The enrolling user for registration; omitted for login.
 */
export async function storeChallenge(
  challenge: string,
  ceremony: Ceremony,
  userId?: string,
): Promise<void> {
  await db.insert(webauthnChallenges).values({
    challenge,
    ceremony,
    userId: userId ?? null,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
}

/**
 * Consume a challenge: confirm it exists, isn't expired, and matches the
 * ceremony, then delete it so it can't be replayed. Mirrors `consumeOAuthState`.
 *
 * @returns  The userId stored with the challenge (null for login challenges).
 * @throws   401 if the challenge is unknown, expired, or for the wrong ceremony.
 */
export async function consumeChallenge(
  challenge: string,
  ceremony: Ceremony,
): Promise<{ userId: string | null }> {
  const row = await db.query.webauthnChallenges.findFirst({
    where: and(
      eq(webauthnChallenges.challenge, challenge),
      eq(webauthnChallenges.ceremony, ceremony),
    ),
  });

  if (row) {
    await db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, row.id));
  }

  if (!row || row.expiresAt.getTime() < Date.now()) {
    throw errors.unauthorized('Passkey challenge is invalid or expired');
  }

  return { userId: row.userId };
}

/** What a verified registration yields, ready to insert into webauthn_credentials. */
export interface VerifiedRegistration {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string | null;
  deviceType: string | null;
  backedUp: boolean;
}

/**
 * Verify a registration attestation against the issued challenge and return the
 * fields to store. Throws a 400 if the attestation doesn't verify.
 *
 * @param response           The browser's `RegistrationResponseJSON`.
 * @param expectedChallenge  The raw challenge previously issued to this user.
 */
export async function verifyRegistration(
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<VerifiedRegistration> {
  const { rpID, origin } = rpConfig();
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    // We prefer but don't require user verification, matching the options above.
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw errors.validation('Passkey registration could not be verified.');
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  return {
    // Already base64url in v13; store verbatim.
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ? JSON.stringify(credential.transports) : null,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
  };
}

/** What a verified assertion yields: who signed in and the new counter value. */
export interface VerifiedAuthentication {
  userId: string;
  newCounter: number;
  credentialId: string;
}

/**
 * Verify a login assertion: find the stored credential the browser signed with,
 * check the signature against the issued challenge, and report the new counter.
 *
 * A counter that fails to advance is the textbook cloned-authenticator signal,
 * so the library rejects it and we surface that as a failed verification rather
 * than silently letting the login through.
 *
 * @param response           The browser's `AuthenticationResponseJSON`.
 * @param expectedChallenge  The raw challenge previously issued for this login.
 */
export async function verifyAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
): Promise<VerifiedAuthentication> {
  const { rpID, origin } = rpConfig();

  // The assertion's `id` is the base64url credential id we stored at registration.
  const cred = await db.query.webauthnCredentials.findFirst({
    where: eq(webauthnCredentials.credentialId, response.id),
  });
  if (!cred) throw errors.unauthorized('Unknown passkey');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: cred.credentialId,
      publicKey: isoBase64URL.toBuffer(cred.publicKey),
      counter: cred.counter,
      transports: parseTransports(cred.transports),
    },
    requireUserVerification: false,
  });

  if (!verification.verified) {
    throw errors.unauthorized('Passkey could not be verified');
  }

  const newCounter = verification.authenticationInfo.newCounter;
  await db
    .update(webauthnCredentials)
    .set({ counter: newCounter, lastUsedAt: new Date() })
    .where(eq(webauthnCredentials.id, cred.id));

  return { userId: cred.userId, newCounter, credentialId: cred.credentialId };
}

/**
 * Pull the challenge the browser actually signed out of its clientDataJSON. Both
 * verify endpoints need it to look the stored nonce up, but the client only
 * sends the credential response, not the challenge separately. The value is the
 * same base64url string we stored, so it keys straight into `consumeChallenge`.
 */
export function extractChallenge(response: {
  response: { clientDataJSON: string };
}): string {
  const clientData = JSON.parse(isoBase64URL.toUTF8String(response.response.clientDataJSON));
  if (typeof clientData.challenge !== 'string') {
    throw errors.validation('Malformed passkey response.');
  }
  return clientData.challenge;
}

/** Parse the stored transports JSON back into the library's typed array, or undefined. */
function parseTransports(raw: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AuthenticatorTransportFuture[]) : undefined;
  } catch {
    return undefined;
  }
}
