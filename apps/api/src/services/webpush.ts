// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Web Push delivery for the browser client, the web-side counterpart to apns.ts.
 *
 * Like APNs this runs on Cloudflare Workers, so everything is WebCrypto: the
 * VAPID provider token is an ES256 JWT (same shape as the APNs one), and the
 * payload is sealed with the RFC 8291 `aes128gcm` scheme so the push service
 * (Mozilla, Google, Apple) only ever relays ciphertext. Nobody between here and
 * the user's browser can read what's in the notification.
 *
 * The visible text is deliberately thin: a type label, never the sender or the
 * message body. Message bodies are end-to-end encrypted and the server can't
 * read them anyway; for everything else we still keep the lock-screen text
 * contentless on purpose. Routing data (the notification id and a section URL)
 * rides inside the encrypted payload, which the push service can't see.
 *
 * All best-effort: if the VAPID secrets aren't set (local dev, tests) we no-op,
 * and one dead subscription never throws back into the request that triggered it.
 */
import { loadServerEnv } from '@counter/config/env';
import { db, webPushSubscriptions, eq } from '@counter/db';
import { decryptField } from '../lib/crypto.ts';
import type { NotificationType } from '@counter/config';
import type { PushPayload } from './apns.ts';

const encoder = new TextEncoder();

// --- base64url helpers (no padding), the encoding both VAPID and the
// subscription keys arrive in ---

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Concatenate byte arrays into one buffer. */
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// --- VAPID provider token (ES256 JWT) ---

// Tokens are valid for hours, so cache the signed JWT per audience (the push
// service origin) and re-sign only when it's close to expiry. Module scope is
// fine for the same reason as the APNs cache.
const vapidTokenCache = new Map<string, { jwt: string; exp: number }>();

let vapidSignKey: CryptoKey | null = null;

/** Import the VAPID private key for ES256 signing, building the JWK from the
 *  base64url public point and private scalar. Cached for the isolate's life. */
async function getVapidSignKey(): Promise<CryptoKey | null> {
  if (vapidSignKey) return vapidSignKey;
  const env = loadServerEnv();
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;

  const pub = b64urlDecode(env.VAPID_PUBLIC_KEY); // 0x04 || x(32) || y(32)
  if (pub.length !== 65) return null;
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    d: env.VAPID_PRIVATE_KEY,
    ext: true,
  };
  vapidSignKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return vapidSignKey;
}

/** Build the `Authorization: vapid ...` header value for one push service origin. */
async function vapidAuthHeader(audience: string): Promise<string | null> {
  const env = loadServerEnv();
  const key = await getVapidSignKey();
  if (!key) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const cached = vapidTokenCache.get(audience);
  // Re-sign with an hour of headroom so a cached token never goes out expired.
  let jwt = cached && cached.exp - nowSec > 3600 ? cached.jwt : null;

  if (!jwt) {
    // The spec caps lifetime at 24h; 12h keeps us well inside it.
    const exp = nowSec + 12 * 3600;
    const header = b64urlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const payload = b64urlEncode(
      encoder.encode(JSON.stringify({ aud: audience, exp, sub: env.VAPID_SUBJECT })),
    );
    const signingInput = `${header}.${payload}`;
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      encoder.encode(signingInput),
    );
    jwt = `${signingInput}.${b64urlEncode(new Uint8Array(sig))}`;
    vapidTokenCache.set(audience, { jwt, exp });
  }

  // `k` is the public key the push service uses to verify the token's signature.
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`;
}

// --- RFC 8291 / RFC 8188 payload encryption (aes128gcm) ---

/** HKDF (extract + expand) via WebCrypto, which does both in one deriveBits. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Encrypt a payload for one subscription with the aes128gcm content encoding.
 *
 * Returns the full request body: `salt(16) || rs(4) || idlen(1) || as_public(65)
 * || ciphertext`, which is exactly what a browser's PushManager expects to
 * decrypt with its private key.
 */
async function encryptPayload(plaintext: Uint8Array, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(p256dhB64); // 65-byte client public point
  const authSecret = b64urlDecode(authB64); // 16-byte client auth secret

  // Server's ephemeral ECDH key pair for this single message. The generated
  // Workers crypto types model generateKey's result as CryptoKey | CryptoKeyPair
  // and exportKey's as JsonWebKey | ArrayBuffer, so narrow both: a P-256 pair and
  // a 'raw' export are always the concrete shapes we use here.
  const generateKey = crypto.subtle.generateKey as (
    algorithm: { name: string; namedCurve: string },
    extractable: boolean,
    usages: string[],
  ) => Promise<CryptoKeyPair>;
  const asKeys = await generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', asKeys.publicKey)) as ArrayBuffer,
  ); // 65 bytes

  const uaPublicKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  // The `public` field is the standard EcdhKeyDeriveParams shape workerd accepts
  // at runtime; the generated Workers types spell it differently, so cast past
  // them rather than feed the runtime a name it doesn't know.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- workerd takes
  // the standard { public } EcdhKeyDeriveParams at runtime; the Workers types
  // model it under a different name, so cast past them.
  const ecdhParams = { name: 'ECDH', public: uaPublicKey } as any;
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(ecdhParams, asKeys.privateKey, 256),
  );

  // RFC 8291 §3.4: mix the auth secret into the ECDH output, bound to both
  // public keys, to get the input keying material for the content encryption.
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // RFC 8188: derive the content key and nonce from a fresh random salt.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  // Single record: append the 0x02 delimiter that marks the last record, then
  // seal with AES-128-GCM. rs (record size) is set large enough to hold it all.
  const record = concat(plaintext, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record),
  );

  const rs = new Uint8Array([0, 0, 0x10, 0x00]); // 4096
  const idlen = new Uint8Array([asPublic.length]); // 65
  return concat(salt, rs, idlen, asPublic, ciphertext);
}

// --- visible text (thin: type only, never the actor or content) ---

function bodyText(type: NotificationType): string {
  switch (type) {
    case 'like':
      return 'Someone liked your post';
    case 'repost':
      return 'Someone reposted your post';
    case 'reply':
      return 'New reply to your post';
    case 'follow':
      return 'You have a new follower';
    case 'mention':
      return 'You were mentioned';
    case 'message':
      return 'New message';
    case 'tunnel_invite':
      return 'New Tunnel Talk invite';
  }
}

// Section to open on click. Deliberately generic (no ids), so even the encrypted
// payload carries no identifying routing, only where in the app to land.
function targetUrl(type: NotificationType): string {
  return type === 'message' ? '/messages' : '/notifications';
}

/**
 * Send a web push to every browser a user has subscribed.
 *
 * Awaited for the same reason as deliverPush: the request's DB connection is
 * gone once the response is sent, and we need it to read subscriptions and prune
 * dead ones. The encryption and HTTP calls run in parallel across subscriptions.
 */
export async function deliverWebPush(userId: string, payload: PushPayload): Promise<void> {
  const env = loadServerEnv();
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;

  const rows = await db
    .select()
    .from(webPushSubscriptions)
    .where(eq(webPushSubscriptions.userId, userId));
  if (rows.length === 0) return;

  const body = JSON.stringify({
    type: payload.type,
    notificationId: payload.notificationId,
    body: bodyText(payload.type),
    url: targetUrl(payload.type),
  });
  const plaintext = encoder.encode(body);

  const results = await Promise.allSettled(
    rows.map(async (sub) => {
      const endpoint = await decryptField(sub.endpoint, env.MESSAGE_ENCRYPTION_KEY);
      const auth = await vapidAuthHeader(new URL(endpoint).origin);
      if (!auth) throw new Error('VAPID not configured');

      const encrypted = await encryptPayload(plaintext, sub.p256dh, sub.auth);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: auth,
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          // 4 weeks: hold the push if the browser is offline, within reason.
          ttl: '2419200',
        },
        body: encrypted,
      });
      return { id: sub.id, status: res.status };
    }),
  );

  // 404/410 mean the subscription is gone (browser unsubscribed or expired), so
  // drop it rather than keep paying to push into the void.
  const dead = results
    .filter(
      (r): r is PromiseFulfilledResult<{ id: string; status: number }> =>
        r.status === 'fulfilled' && (r.value.status === 404 || r.value.status === 410),
    )
    .map((r) => r.value.id);
  for (const id of dead) {
    await db.delete(webPushSubscriptions).where(eq(webPushSubscriptions.id, id));
  }
}
