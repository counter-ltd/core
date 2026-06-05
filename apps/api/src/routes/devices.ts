// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Push-device registration: users explicitly register their devices here so
 * notifications can be delivered, and can remove devices from the Privacy
 * settings panel. Registration is opt-in -- the client never auto-uploads a
 * token without the user's action.
 *
 * The whole router is behind auth because a device always belongs to whoever
 * is signed in on it.
 */
import { Hono } from 'hono';
import { db, devices, eq, and } from '@counter/db';
import { loadServerEnv } from '@counter/config/env';
import { registerDeviceSchema } from '@counter/types';
import { body } from '../lib/validate.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import { blindIndex, encryptField } from '../lib/crypto.ts';
import type { AppEnv } from '../types.ts';

export const deviceRoutes = new Hono<AppEnv>();

deviceRoutes.use('*', requireAuth);

// --- list ---

deviceRoutes.get('/', async (c) => {
  const userId = requireUserId(c);
  const rows = await db
    .select({
      id: devices.id,
      platform: devices.platform,
      name: devices.name,
      createdAt: devices.createdAt,
      lastSeenAt: devices.lastSeenAt,
    })
    .from(devices)
    .where(eq(devices.userId, userId))
    .orderBy(devices.createdAt);

  return c.json(rows);
});

// --- register ---

// Upsert keyed on the token: re-registering the same token (a relaunch, or the
// same phone signing into a different account) re-points it to the current user
// and bumps last_seen_at instead of erroring on the unique token. So a device
// only ever delivers to the account currently signed in on it.
deviceRoutes.post('/', async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, registerDeviceSchema);

  // .returning() gives us the id whether this was an insert or an upsert.
  // The array is always length-1 for a single-row upsert, but TypeScript
  // can't prove that, so we fall back to an empty string to satisfy the type
  // checker -- in practice a missing row here would mean a DB error that
  // threw before we got here.
  // Token is encrypted at rest. The blind index carries the unique constraint
  // and is the conflict target, since the randomised ciphertext can't be matched.
  const env = loadServerEnv();
  const tokenIndex = await blindIndex(input.token, env.BLIND_INDEX_KEY);
  const token = await encryptField(input.token, env.MESSAGE_ENCRYPTION_KEY);
  const [row] = await db
    .insert(devices)
    .values({ userId, platform: input.platform, token, tokenIndex, name: input.name ?? null })
    .onConflictDoUpdate({
      target: devices.tokenIndex,
      // Re-encrypt on re-register so the ciphertext is fresh; the blind index
      // stays put, which is what makes this an upsert rather than a new row.
      set: {
        userId,
        platform: input.platform,
        token,
        name: input.name ?? null,
        lastSeenAt: new Date(),
      },
    })
    .returning({ id: devices.id });

  return c.json({ ok: true, id: row?.id ?? '' });
});

// --- unregister by id ---

// Delete by device id (UUID), scoped to the caller. Clients use this from the
// Privacy panel where they have the id from GET /devices, not the raw token.
deviceRoutes.delete('/by-id/:id', async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  await db.delete(devices).where(and(eq(devices.id, id), eq(devices.userId, userId)));
  return c.json({ ok: true });
});

// --- unregister by token ---

// Drop a token on sign-out. Scoped to the caller's own rows so one account
// can't deregister another's device; a token that isn't theirs (or is already
// gone) just deletes nothing and still returns ok.
deviceRoutes.delete('/:token', async (c) => {
  const userId = requireUserId(c);
  const token = c.req.param('token');
  // Match on the blind index of the supplied token, since the stored column is
  // ciphertext. Scoped to the caller so one account can't drop another's device.
  const tokenIndex = await blindIndex(token, loadServerEnv().BLIND_INDEX_KEY);
  await db.delete(devices).where(and(eq(devices.tokenIndex, tokenIndex), eq(devices.userId, userId)));
  return c.json({ ok: true });
});
