// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * WebCrypto-based primitives. These run identically on Cloudflare Workers and
 * Bun (no Node built-ins, no Bun-specific APIs), so the same code hashes
 * passwords at runtime and in the seed script.
 */

// Work factor for new hashes. Higher means slower to brute-force but also
// slower for us; 100k is a sane WebCrypto PBKDF2 floor. Stored hashes record
// the iteration count they were made with, so this can rise over time without
// breaking the ability to verify older passwords.
const PBKDF2_ITERATIONS = 100_000;
const KEY_BITS = 256;

const encoder = new TextEncoder();

/** base64-encode raw bytes via the binary-string bridge btoa expects. */
function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/** Inverse of toBase64: decode base64 back to the original bytes. */
function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Stretch a password into key material with PBKDF2-SHA256.
 *
 * The salt and iteration count are passed in (not pulled from the constant) so
 * verification can replay the exact parameters stored alongside an old hash.
 */
async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/**
 * Hash a password for storage.
 *
 * The result is self-describing: `pbkdf2$<iterations>$<saltB64>$<hashB64>`
 * carries everything verifyPassword needs to re-derive and compare, so we can
 * change the iteration count later without a migration. A random per-password
 * salt means two users with the same password get different hashes.
 *
 * @returns A single string safe to drop straight into a varchar column.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveBits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/**
 * Compare two byte arrays without short-circuiting on the first difference.
 *
 * A normal `===` or early-return loop leaks, through how long it runs, how much
 * of the value matched, which an attacker can use to recover a secret byte by
 * byte. XOR-ing every byte keeps the timing flat regardless of where they
 * diverge.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Check a password against a stored hash, returning false on any mismatch.
 *
 * Reads the iteration count and salt back out of the stored string so even
 * hashes made under older settings still verify. A malformed stored value
 * fails closed rather than throwing.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const salt = fromBase64(parts[2]!);
  const expected = fromBase64(parts[3]!);
  const actual = await deriveBits(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

/**
 * Lowercase hex SHA-256 of a string.
 *
 * Used for refresh-token hashes (see auth.ts), where the input is already a
 * high-entropy random token, so a fast hash is the right tool and the slow
 * PBKDF2 above would be wasted effort.
 */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
