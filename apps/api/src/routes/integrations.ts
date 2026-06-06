// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Linked-account endpoints: connect an external profile, prove you control it
 * via rel="me", and manage the links.
 *
 * A verified link becomes a trust badge on the profile (see services/trust.ts).
 * Verifying is optional and earns only a badge, it never gates anything, which
 * keeps this on the right side of the CSL. Listing is public; mutating requires
 * the owner.
 */
import { Hono } from 'hono';
import { db, integrations, users, eq, and } from '@counter/db';
import { addIntegrationSchema, patchIntegrationSchema } from '@counter/types';
import type { Integration } from '@counter/types';
import { body } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import { findUserByUsername } from '../services/userquery.ts';
import { serializeIntegration } from '../services/trust.ts';
import { verifyRelMe } from '../lib/relme.ts';
import type { AppEnv } from '../types.ts';

/** Hono router for all /integrations routes. Mounted by the main app. */
export const integrationRoutes = new Hono<AppEnv>();

/** Best-effort display handle from a URL: the last path segment, else the host. */
function deriveUsername(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.split('/').filter(Boolean).pop() ?? u.hostname;
  } catch {
    return url;
  }
}

// The caller's own links, verified or not, so settings can manage them.
integrationRoutes.get('/me', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const rows = await db.select().from(integrations).where(eq(integrations.userId, userId));
  return c.json<Integration[]>(rows.map(serializeIntegration));
});

// A user's verified, displayed links by username (public). Unverified and
// hidden links stay private so unproven or toggled-off badges never leak.
integrationRoutes.get('/:username', async (c) => {
  const target = await findUserByUsername(c.req.param('username'));
  if (!target) throw errors.notFound('User not found');
  const rows = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.userId, target.id),
        eq(integrations.verified, true),
        eq(integrations.displayed, true),
      ),
    );
  return c.json<Integration[]>(rows.map(serializeIntegration));
});

// Link a platform. One row per (user, platform): re-linking the same platform
// updates the URL and resets verification, so changing where it points means
// proving control again.
integrationRoutes.post('/', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, addIntegrationSchema);
  const [row] = await db
    .insert(integrations)
    .values({
      userId,
      platform: input.platform,
      platformUsername: deriveUsername(input.url),
      platformUrl: input.url,
    })
    .onConflictDoUpdate({
      target: [integrations.userId, integrations.platform],
      set: {
        platformUsername: deriveUsername(input.url),
        platformUrl: input.url,
        verified: false,
        updatedAt: new Date(),
      },
    })
    .returning();
  return c.json<Integration>(serializeIntegration(row!), 201);
});

// Prove control of a linked page: fetch it and look for a rel="me" link back to
// this user's Counter profile. Sets verified to the result either way, so a link
// that loses its back-link later can be re-checked and will drop its badge.
integrationRoutes.post('/:id/verify', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const row = await db.query.integrations.findFirst({
    where: and(eq(integrations.id, id), eq(integrations.userId, userId)),
  });
  if (!row) throw errors.notFound('Link not found');
  if (!row.platformUrl) throw errors.validation('This link has no URL to verify.');

  const me = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const webUrl = c.env.PUBLIC_WEB_URL ?? 'https://counter.ltd';
  const profileUrl = `${webUrl}/${me!.username}`;

  const verified = await verifyRelMe(row.platformUrl, profileUrl);
  await db
    .update(integrations)
    .set({ verified, updatedAt: new Date() })
    .where(eq(integrations.id, id));
  return c.json<Integration>(serializeIntegration({ ...row, verified }));
});

// Toggle whether a verified badge shows on the public profile. The link and
// its verified state are untouched; only the display flag changes.
integrationRoutes.patch('/:id', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const input = await body(c, patchIntegrationSchema);
  const [row] = await db
    .update(integrations)
    .set({ displayed: input.displayed, updatedAt: new Date() })
    .where(and(eq(integrations.id, id), eq(integrations.userId, userId)))
    .returning();
  if (!row) throw errors.notFound('Link not found');
  return c.json<Integration>(serializeIntegration(row));
});

// Remove a link. Scoped to the owner so an id alone can't delete someone else's.
integrationRoutes.delete('/:id', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  await db.delete(integrations).where(and(eq(integrations.id, id), eq(integrations.userId, userId)));
  return c.json({ ok: true });
});
