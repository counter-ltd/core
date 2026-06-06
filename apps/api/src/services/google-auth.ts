// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Google service-account auth for Workers.
 *
 * Cloudflare Workers run off-GCP, so there's no metadata server to hand out
 * Application Default Credentials. To call a Google API (here, Vertex AI's
 * OpenAI-compatible endpoint) we do the JWT-bearer flow by hand: build a JWT
 * signed with the service account's private key, trade it at Google's token
 * endpoint for a short-lived access token, and cache that token until it's
 * about to expire.
 *
 * This exists because the org policy on the GCP side disallows static API keys
 * and steers everything through service-account credentials.
 */

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** Service-account fields the JWT flow needs. */
export interface GoogleServiceAccount {
  clientEmail: string;
  /** PEM PKCS#8. May arrive with literal "\n" sequences from a JSON-sourced env var. */
  privateKey: string;
}

// Per-isolate token cache. Workers reuse an isolate across requests when warm,
// so this avoids re-minting on every /ask. A token is good for an hour; we
// refresh a minute early to dodge clock skew at the boundary.
let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Get a valid Google OAuth access token for the service account, minting and
 * caching a fresh one when needed.
 *
 * @param sa  The service-account credentials.
 * @returns A bearer access token scoped to cloud-platform.
 */
export async function getGoogleAccessToken(sa: GoogleServiceAccount): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.value;
  }

  const assertion = await buildSignedJwt(sa);

  const res = await fetch(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token exchange returned ${res.status}`);
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error('Google token exchange returned no access_token');
  }

  const ttlMs = (data.expires_in ?? 3600) * 1000;
  // Refresh 60s before the real expiry so an in-flight call never uses a token
  // that lapses mid-request.
  cachedToken = { value: data.access_token, expiresAt: now + ttlMs - 60_000 };
  return cachedToken.value;
}

/**
 * Build and RS256-sign the JWT assertion for the token exchange.
 *
 * @param sa  The service-account credentials.
 * @returns The compact-serialized, signed JWT.
 */
async function buildSignedJwt(sa: GoogleServiceAccount): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.clientEmail,
    scope: SCOPE,
    aud: TOKEN_URI,
    iat: nowSec,
    // Max JWT lifetime Google accepts is one hour.
    exp: nowSec + 3600,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const key = await importPrivateKey(sa.privateKey);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64urlBytes(new Uint8Array(signature))}`;
}

/**
 * Import a PEM PKCS#8 private key for RS256 signing.
 *
 * @param pem  The PEM string, possibly with escaped "\n" line breaks.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // A key pulled from JSON-in-env often has its newlines escaped; restore them
  // before stripping the PEM armor.
  const normalized = pem.replace(/\\n/g, '\n');
  const body = normalized
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');

  const der = base64ToBytes(body);

  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

// --- encoding helpers ---

/** Base64url-encode a UTF-8 string (no padding). */
function base64url(input: string): string {
  return base64urlBytes(new TextEncoder().encode(input));
}

/** Base64url-encode raw bytes (no padding). */
function base64urlBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode standard base64 (the PEM body) into bytes. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
