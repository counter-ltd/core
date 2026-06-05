// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Browser Web Push subscription management, the web counterpart to /devices.
 *
 * A signed-in user opts in from their notification settings: the browser hands
 * us a PushSubscription, we store it (endpoint encrypted at rest), and from then
 * on createNotification fans pushes out to it. Unsubscribing drops the row.
 *
 * The whole router is behind auth because a subscription always belongs to
 * whoever is signed in on that browser.
 */
import { Hono } from 'hono';
import { db, webPushSubscriptions, eq, and } from '@counter/db';
import { loadServerEnv } from '@counter/config/env';
import { webPushSubscribeSchema, webPushUnsubscribeSchema } from '@counter/types';
import { body } from '../lib/validate.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import { blindIndex, encryptField } from '../lib/crypto.ts';
import type { AppEnv } from '../types.ts';

export const webPushRoutes = new Hono<AppEnv>();

webPushRoutes.use('*', requireAuth);

// --- VAPID public key ---

// The browser needs this to call pushManager.subscribe. It's public by design
// (it's what verifies our signed pushes), so returning it is safe; empty when
// web push isn't configured, which the client treats as "feature unavailable".
webPushRoutes.get('/vapid-public-key', (c) => {
  return c.json({ key: loadServerEnv().VAPID_PUBLIC_KEY || null });
});

// --- subscribe ---

// Upsert keyed on the endpoint's blind index: re-subscribing the same browser
// (a new key rotation, or signing into a different account) re-points it to the
// current user instead of erroring on the unique endpoint.
webPushRoutes.post('/subscribe', async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, webPushSubscribeSchema);

  // Endpoint is encrypted at rest; the blind index carries the unique constraint
  // and is the conflict target, since the randomised ciphertext can't be matched.
  const env = loadServerEnv();
  const endpointIndex = await blindIndex(input.endpoint, env.BLIND_INDEX_KEY);
  const endpoint = await encryptField(input.endpoint, env.MESSAGE_ENCRYPTION_KEY);

  const [row] = await db
    .insert(webPushSubscriptions)
    .values({
      userId,
      endpoint,
      endpointIndex,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    })
    .onConflictDoUpdate({
      target: webPushSubscriptions.endpointIndex,
      // Re-encrypt and refresh the keys on re-subscribe; the blind index stays
      // put, which is what makes this an upsert rather than a duplicate row.
      set: {
        userId,
        endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        lastSeenAt: new Date(),
      },
    })
    .returning({ id: webPushSubscriptions.id });

  return c.json({ ok: true, id: row?.id ?? '' });
});

// --- unsubscribe ---

// Drop a subscription when the browser unsubscribes or the user turns the
// feature off. Scoped to the caller's own rows so one account can't deregister
// another's browser; an endpoint that isn't theirs deletes nothing and still ok.
webPushRoutes.delete('/subscribe', async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, webPushUnsubscribeSchema);
  const endpointIndex = await blindIndex(input.endpoint, loadServerEnv().BLIND_INDEX_KEY);
  await db
    .delete(webPushSubscriptions)
    .where(
      and(eq(webPushSubscriptions.endpointIndex, endpointIndex), eq(webPushSubscriptions.userId, userId)),
    );
  return c.json({ ok: true });
});
