// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Client-side end-to-end encryption for Counter direct messages.
 *
 * Algorithm: ECDH P-256 + HKDF-SHA256 + AES-256-GCM. Per-message ephemeral
 * keys give forward secrecy: compromising a long-term private key cannot
 * decrypt past messages.
 *
 * Multi-device format (v3): the sender encrypts a separate copy for every
 * registered device key on both sides — recipient devices to receive the
 * message, sender devices to read their own sent messages. Each copy is a
 * self-contained v2 envelope. All copies are base64-encoded JSON wrapped in
 * the `v3:` prefix.
 *
 * Key storage: the private key is persisted as JWK in localStorage. The
 * device ID (a stable UUID) is stored separately so it survives a key
 * rotation without creating a new identity. If localStorage is cleared, a
 * new key pair and device ID are generated; old ciphertexts for the previous
 * device key will show "[Encrypted with a previous key]".
 *
 * This module is browser-only: it uses window.crypto.subtle and localStorage.
 */

import type { DeviceKey } from '@counter/types';

const STORAGE_KEY = 'counter_e2ee_priv';
const DEVICE_ID_KEY = 'counter_e2ee_device_id';

// Explicit Uint8Array<ArrayBuffer> so TypeScript 5.7's tighter BufferSource
// constraint is satisfied when passing this to deriveKey's info param.
const HKDF_INFO: Uint8Array<ArrayBuffer> = new Uint8Array(
  new TextEncoder().encode('counter-dm-v1'),
);
const IV_BYTES = 12;

// Loop-based concat avoids spreading a large Uint8Array as function arguments,
// which can overflow the call stack for kilobyte-sized buffers.
function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

/** Decode a standard base64 string back to bytes. */
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Result of {@link loadOrGenerateKeyPair}. */
export interface KeySetup {
  keyPair: CryptoKeyPair;
  /** Stable device identifier; matches the `deviceId` field in registered key rows. */
  deviceId: string;
  /** True when a fresh pair was generated; caller should register the public key. */
  isNew: boolean;
}

/**
 * Load the stored key pair and device ID from localStorage, or generate fresh
 * ones if none exist (or if the stored JWK is corrupted). When `isNew` is true
 * the caller must upload the public key via POST /auth/keys so others can
 * encrypt messages for this device.
 *
 * The device ID is stored independently of the key pair so it can survive a
 * key rotation: replacing the key pair with a new one keeps the same device ID,
 * avoiding the creation of a phantom second device row on the server.
 */
export async function loadOrGenerateKeyPair(): Promise<KeySetup> {
  // Load or generate a stable device ID independent of the key pair.
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const privateJwk: JsonWebKey = JSON.parse(raw);
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        privateJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
      );
      // P-256 private JWKs carry x and y alongside d, so we can reconstruct
      // the public key by dropping d rather than storing a second JWK.
      const { d: _d, key_ops: _ops, ...pubFields } = privateJwk as Record<string, unknown>;
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        { ...pubFields, key_ops: [] },
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        [],
      );
      return { keyPair: { privateKey, publicKey }, deviceId, isNew: false };
    } catch {
      // Stored JWK is unparseable or invalid; fall through to generate a fresh pair.
    }
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jwk));
  return { keyPair, deviceId, isNew: true };
}

/**
 * Export a public key to the SPKI base64 string that the API stores in
 * `device_keys.public_key` and returns from GET /users/:username/public-key.
 *
 * @param publicKey - The CryptoKey to export.
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  return toBase64(new Uint8Array(spki));
}

/** Shared ECDH + HKDF step used by both encrypt and decrypt paths. */
async function deriveAesKey(
  myPrivateKey: CryptoKey,
  theirPublicKey: CryptoKey,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  // ECDH produces a shared secret. Feed it into HKDF rather than using it
  // directly as an AES key so the output is domain-separated and length-fixed.
  const rawSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirPublicKey },
    myPrivateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey('raw', rawSecret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: HKDF_INFO },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

/**
 * Encrypt plaintext for a single recipient public key. Returns a `v2:` envelope.
 * Internal; callers outside this module should use {@link encryptForDevices}.
 */
async function encryptForKey(plaintext: string, recipientPublicKeyB64: string): Promise<string> {
  const recipientPub = await crypto.subtle.importKey(
    'spki',
    fromBase64(recipientPublicKeyB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const ephPubSpki = await crypto.subtle.exportKey('spki', ephemeral.publicKey);
  const aesKey = await deriveAesKey(ephemeral.privateKey, recipientPub, 'encrypt');

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    // Wrap in new Uint8Array to satisfy TypeScript 5.7's BufferSource constraint.
    new Uint8Array(new TextEncoder().encode(plaintext)),
  );

  return `v2:${toBase64(new Uint8Array(ephPubSpki))}:${toBase64(iv)}:${toBase64(new Uint8Array(ct))}`;
}

/**
 * Encrypt a plaintext message for all target devices (recipient + sender).
 * Returns a `v3:` ciphertext: a base64-encoded JSON array where each entry
 * holds the device ID and a `v2:` envelope encrypted for that device's key.
 *
 * Including sender device keys ensures the sender can read their own sent
 * messages on any registered device.
 *
 * @param plaintext - The raw message body.
 * @param recipientDeviceKeys - All device keys registered by the recipient.
 * @param senderDeviceKeys - All device keys registered by the sender (including current device).
 */
export async function encryptForDevices(
  plaintext: string,
  recipientDeviceKeys: DeviceKey[],
  senderDeviceKeys: DeviceKey[],
): Promise<string> {
  // Combine and deduplicate in case the sender is messaging themselves in a
  // test scenario (same device ID appears on both sides).
  const seen = new Set<string>();
  const targets = [...recipientDeviceKeys, ...senderDeviceKeys].filter(
    (k) => !seen.has(k.deviceId) && seen.add(k.deviceId),
  );

  const copies = await Promise.all(
    targets.map(async (target) => ({
      d: target.deviceId,
      b: await encryptForKey(plaintext, target.publicKey),
    })),
  );

  // JSON is ASCII-safe (device IDs are UUIDs, b values are base64+colons).
  return `v3:${btoa(JSON.stringify(copies))}`;
}

/**
 * Decrypt a message body using the local private key.
 *
 * Handles both legacy `v2:` (single-device) and current `v3:` (multi-device)
 * formats. For v3, finds the copy matching `myDeviceId` and decrypts it.
 * Non-encrypted bodies (no recognized prefix) are returned unchanged.
 *
 * @param ciphertext - The body field from a DirectMessage with `encrypted: true`.
 * @param privateKey - The private key from {@link loadOrGenerateKeyPair}.
 * @param myDeviceId - The stable device ID from {@link loadOrGenerateKeyPair}. Required for v3.
 */
export async function decryptMessage(
  ciphertext: string,
  privateKey: CryptoKey,
  myDeviceId?: string,
): Promise<string> {
  if (ciphertext.startsWith('v3:')) {
    if (!myDeviceId) throw new Error('Device ID required to decrypt v3 message');

    // Decode the JSON copy list and find the entry for this device.
    const copies = JSON.parse(atob(ciphertext.slice(3))) as Array<{ d: string; b: string }>;
    const myCopy = copies.find((c) => c.d === myDeviceId);
    if (!myCopy) throw new Error('No copy for this device');

    // Recurse into the v2 path to decrypt the found copy.
    return decryptMessage(myCopy.b, privateKey);
  }

  if (!ciphertext.startsWith('v2:')) return ciphertext;

  // Format: v2:<ephPubB64>:<ivB64>:<ctB64>
  // Base64 never contains ':', so splitting yields exactly 4 parts.
  const parts = ciphertext.split(':');
  if (parts.length !== 4) throw new Error('Malformed E2EE message');

  const ephPub = await crypto.subtle.importKey(
    'spki',
    fromBase64(parts[1]!),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const aesKey = await deriveAesKey(privateKey, ephPub, 'decrypt');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(parts[2]!) },
    aesKey,
    fromBase64(parts[3]!),
  );
  return new TextDecoder().decode(plaintext);
}
