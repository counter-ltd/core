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

// --- AES-256-GCM message body encryption ---

// 96-bit IV: the recommended size for AES-GCM. Random per message, never reused.
const AES_IV_BYTES = 12;

/**
 * Decode a hex string to raw bytes. Used to load the key material from the
 * Worker secret, which we store as hex so it's easy to generate with openssl.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i >> 1] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

// Isolate-level cache: importing a CryptoKey is not free. Since the key
// constant doesn't change for the lifetime of the Worker isolate, caching it
// here means we pay the import cost once per cold start, not once per request.
const aesKeyCache = new Map<string, CryptoKey>();

async function importAesKey(hexKey: string): Promise<CryptoKey> {
  const hit = aesKeyCache.get(hexKey);
  if (hit) return hit;
  const raw = hexToBytes(hexKey);
  if (raw.length !== 32) throw new Error('MESSAGE_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  aesKeyCache.set(hexKey, key);
  return key;
}

/**
 * Encrypt a message body for storage with AES-256-GCM.
 *
 * Stored format: `v1:<base64-iv>:<base64-ciphertext>`. The `v1:` prefix is a
 * version tag so if we ever rotate to a different scheme, old rows can still be
 * read by checking which prefix they carry.
 *
 * @param plaintext  The message body to encrypt.
 * @param hexKey     The 64-char hex MESSAGE_ENCRYPTION_KEY from `c.env`.
 */
export async function encryptMessage(plaintext: string, hexKey: string): Promise<string> {
  const key = await importAesKey(hexKey);
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  );
  return `v1:${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
}

/**
 * Decrypt a stored message body.
 *
 * Rows that pre-date encryption don't carry the `v1:` prefix and are returned
 * unchanged, so an in-place rollout doesn't break any existing messages. Once
 * every old row has been re-encrypted (or you're happy to show them as-is),
 * that plaintext fallback can be removed.
 *
 * @param stored   The raw value read from the database.
 * @param hexKey   The 64-char hex MESSAGE_ENCRYPTION_KEY from `c.env`.
 */
export async function decryptMessage(stored: string, hexKey: string): Promise<string> {
  // Pre-encryption rows are plain text; return them as-is.
  if (!stored.startsWith('v1:')) return stored;
  const [, ivB64, ctB64] = stored.split(':');
  const key = await importAesKey(hexKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivB64!) },
    key,
    fromBase64(ctB64!),
  );
  return new TextDecoder().decode(plaintext);
}

// --- generic field encryption ---

// Same AES-256-GCM scheme as messages, just named for the wider job: any
// at-rest column we want unreadable in a database dump (email, OAuth provider
// email, push tokens). encryptField writes the `v1:` envelope; decryptField
// reads it back and passes through anything without the prefix unchanged, so a
// pre-encryption value never throws.
export { encryptMessage as encryptField, decryptMessage as decryptField };

// --- blind index ---

// HMAC keys are imported once per isolate, same reasoning as the AES cache.
const hmacKeyCache = new Map<string, CryptoKey>();

async function importHmacKey(hexKey: string): Promise<CryptoKey> {
  const hit = hmacKeyCache.get(hexKey);
  if (hit) return hit;
  const raw = hexToBytes(hexKey);
  if (raw.length !== 32) throw new Error('BLIND_INDEX_KEY must be 64 hex chars (32 bytes)');
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  hmacKeyCache.set(hexKey, key);
  return key;
}

/**
 * Deterministic keyed hash of a value, for looking up an encrypted column.
 *
 * AES-GCM uses a random IV per write, so two encryptions of the same email
 * produce different ciphertext, which means you can't query by it. The blind
 * index solves that: HMAC-SHA256 is deterministic, so the same input always
 * maps to the same hex digest, which we store in a unique column and match on at
 * login / signup / OAuth-link time. It's keyed (not a plain SHA-256) so a leaked
 * dump can't be dictionary-attacked to recover which emails are present without
 * also stealing BLIND_INDEX_KEY, which lives only in the Worker secret store.
 *
 * @param value   The plaintext to index (lower-case it first for emails).
 * @param hexKey  The 64-char hex BLIND_INDEX_KEY.
 * @returns Lower-case hex digest, safe to drop into a unique text column.
 */
export async function blindIndex(value: string, hexKey: string): Promise<string> {
  const key = await importHmacKey(hexKey);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether a stored message body is an E2EE ciphertext that the server cannot
 * decrypt. Matches both `v2:` (single-device, legacy) and `v3:` (multi-device)
 * formats; the server passes either through to clients as-is.
 */
export function isE2eeMessage(body: string): boolean {
  return body.startsWith('v2:') || body.startsWith('v3:');
}

/**
 * Whether a body is a v3 multi-device E2EE ciphertext. New sends must use v3
 * so every registered device (sender and recipient) gets a decryptable copy.
 */
export function isV3Message(body: string): boolean {
  return body.startsWith('v3:');
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
