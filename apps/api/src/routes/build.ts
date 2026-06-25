// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Build-announce endpoint, the trigger for Thing Five's app-build announcements.
 *
 * The off-device upload pipeline (ASCManager-MacOS) POSTs /build/announce after
 * a build lands in App Store Connect. Unlike the GitHub webhook this isn't a
 * signed delivery, so it's gated by a shared bearer secret instead. On a valid
 * call we hand the payload to the announce service in the background and ACK now.
 */

import { Hono } from 'hono';
import { loadServerEnv } from '@counter/config/env';
import type { AppEnv } from '../types.ts';
import { announceBuild, type BuildAnnouncePayload } from '../services/build-announce.ts';

export const buildRoutes = new Hono<AppEnv>();

/** Constant-time string compare so a bad token can't be timed out character by character. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Pull the bearer token from the Authorization header (or '' if absent). */
function bearer(header: string | undefined): string {
  const h = header ?? '';
  return h.startsWith('Bearer ') ? h.slice('Bearer '.length).trim() : '';
}

buildRoutes.post('/announce', async (c) => {
  const env = loadServerEnv();

  // No secret configured means the endpoint isn't wired up. 501 so it reads as a
  // config gap, not an auth rejection of a real call.
  if (!env.BUILD_ANNOUNCE_SECRET) {
    return c.json({ error: 'Build announce not configured' }, 501);
  }

  if (!timingSafeEqual(bearer(c.req.header('authorization')), env.BUILD_ANNOUNCE_SECRET)) {
    return c.json({ error: 'Invalid announce token' }, 401);
  }

  const payload = (await c.req.json().catch(() => ({}))) as BuildAnnouncePayload;
  if (!payload.app || !String(payload.app).trim()) {
    return c.json({ error: 'Missing app name' }, 400);
  }

  // Post as Five in the background; ACK now so the uploader isn't blocked on
  // Discord (and the model quip).
  c.executionCtx.waitUntil(announceBuild(env, payload));
  return c.json({ ok: true });
});
