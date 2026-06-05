// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Apple Push Notification delivery for the iOS app.
 *
 * Counter runs on Cloudflare Workers, which rules out the usual node:crypto APNs
 * libraries, so this talks to Apple's HTTP/2 provider API directly and signs the
 * provider JWT with WebCrypto (ES256). Everything here is best-effort: if the
 * APNS_* secrets aren't configured (local dev, tests) we no-op, and a single
 * device failing never throws back into the request that triggered the push.
 *
 * The notification row is the source of truth; push is just a courtesy copy.
 */
import { loadServerEnv } from '@counter/config/env';
import { db, devices, notifications, users, eq, and, count } from '@counter/db';
import { decryptField } from '../lib/crypto.ts';
import type { NotificationType } from '@counter/config';

/** What a push needs to render and route on the device. */
export interface PushPayload {
  /** The notification row id, so a tap can mark it read. */
  notificationId: string;
  type: NotificationType;
  /** Whoever triggered it; the alert text resolves their name from this. */
  actorId: string;
  /** Deep-link targets; only the one relevant to the type is set. */
  postId: string | null;
  conversationId: string | null;
}

// base64url with no padding, the encoding JWS uses for every segment.
function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Pull the raw DER bytes out of a .p8, whether it arrived as full PEM or as a
// bare base64 body. We strip the BEGIN/END lines and all whitespace, then decode
// whatever base64 is left, so both storage formats in APNS_AUTH_KEY just work.
function pkcs8FromAuthKey(authKey: string): Uint8Array {
  const body = authKey
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Apple lets a provider token be reused for up to an hour, so we cache the signed
// JWT and only re-sign once it's ~50 minutes old. Module scope is fine: a Worker
// isolate handles many requests, and re-signing on a cold isolate is cheap.
let cachedToken: { jwt: string; iat: number } | null = null;

/**
 * Build (or reuse) the ES256 provider token APNs wants in the Authorization
 * header. Returns null if the signing secrets aren't configured.
 */
async function providerToken(): Promise<string | null> {
  const env = loadServerEnv();
  if (!env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_AUTH_KEY) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  // 3000s = 50 minutes, comfortably under Apple's 60-minute reuse window.
  if (cachedToken && nowSec - cachedToken.iat < 3000) return cachedToken.jwt;

  const header = base64url(
    new TextEncoder().encode(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID })),
  );
  const payload = base64url(
    new TextEncoder().encode(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: nowSec })),
  );
  const signingInput = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8FromAuthKey(env.APNS_AUTH_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // WebCrypto ECDSA emits the raw r||s pair, which is exactly the signature
  // shape JWS ES256 expects, so no DER unwrapping is needed here.
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${base64url(new Uint8Array(sig))}`;
  cachedToken = { jwt, iat: nowSec };
  return jwt;
}

/** Human-facing alert text for each notification type. */
function alertText(type: NotificationType, actorName: string): { title: string; body: string } {
  switch (type) {
    case 'like':
      return { title: actorName, body: 'liked your post' };
    case 'repost':
      return { title: actorName, body: 'reposted your post' };
    case 'reply':
      return { title: actorName, body: 'replied to your post' };
    case 'follow':
      return { title: actorName, body: 'followed you' };
    case 'mention':
      return { title: actorName, body: 'mentioned you' };
    case 'message':
      return { title: actorName, body: 'sent you a message' };
    case 'tunnel_invite':
      return { title: actorName, body: 'invited you to Tunnel Talk' };
  }
}

/**
 * Send a push to every device a user has registered.
 *
 * Awaited by the caller rather than backgrounded on purpose: the request's DB
 * connection is torn down right after the response on Workers, and we need it
 * here to read the device list, count unread, and prune dead tokens. The APNs
 * calls themselves run in parallel, so the cost is one round-trip, not one per
 * device.
 *
 * @param userId  The recipient whose devices should be notified.
 */
export async function deliverPush(userId: string, payload: PushPayload): Promise<void> {
  const env = loadServerEnv();
  if (!env.APNS_BUNDLE_ID) return; // no topic configured means push is off
  const jwt = await providerToken();
  if (!jwt) return;

  const rows = await db.select().from(devices).where(eq(devices.userId, userId));
  if (rows.length === 0) return;

  // Resolve the actor's name and the unread count together now that we know a
  // push is actually going out. The badge mirrors the inbox total rather than
  // incrementing per push, so the app icon and the list never disagree.
  const [actor, [{ value: unread } = { value: 0 }]] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, payload.actorId) }),
    db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false))),
  ]);
  const actorName = actor?.displayName || (actor ? `@${actor.username}` : 'Someone');

  const text = alertText(payload.type, actorName);
  const apsBody = JSON.stringify({
    aps: { alert: text, badge: Number(unread), sound: 'default' },
    // Custom keys the app reads to route the tap to the right screen. The app
    // navigates by handle, not id, so we send the actor's username: it's the
    // post author for engagement, the sender for a message, the new follower
    // for a follow.
    notificationId: payload.notificationId,
    type: payload.type,
    postId: payload.postId,
    conversationId: payload.conversationId,
    actorUsername: actor?.username ?? null,
  });

  // Tokens are stored encrypted, so decrypt each one right before the call to
  // Apple. We track the device by row id (not the token) so a dead-token prune
  // doesn't need the plain-text value again.
  const results = await Promise.allSettled(
    rows.map(async (d) => {
      const token = await decryptField(d.token, env.MESSAGE_ENCRYPTION_KEY);
      const res = await fetch(`${env.APNS_HOST}/3/device/${token}`, {
        method: 'POST',
        headers: {
          authorization: `bearer ${jwt}`,
          'apns-topic': env.APNS_BUNDLE_ID,
          'apns-push-type': 'alert',
          'apns-priority': '10',
        },
        body: apsBody,
      });
      return { id: d.id, status: res.status };
    }),
  );

  // A 410 (or 400 BadDeviceToken) means Apple has retired that token, so drop it
  // rather than keep paying to push into the void on every future notification.
  const dead = results
    .filter(
      (r): r is PromiseFulfilledResult<{ id: string; status: number }> =>
        r.status === 'fulfilled' && (r.value.status === 410 || r.value.status === 400),
    )
    .map((r) => r.value.id);
  for (const id of dead) {
    await db.delete(devices).where(eq(devices.id, id));
  }
}
