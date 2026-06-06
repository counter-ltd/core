// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * GitHub webhook endpoint, the trigger for Thing Five's commit announcements.
 *
 * A GitHub org webhook (push events) points at POST /github/webhook. We verify
 * the delivery signature, decide whether the push is worth announcing (default
 * branch, allowed org, has commits), then hand it to the announce service in the
 * background so we ACK GitHub well inside its delivery timeout.
 */

import { Hono } from 'hono';
import { loadServerEnv } from '@counter/config/env';
import type { AppEnv } from '../types.ts';
import {
  announcePush,
  branchToAnnounce,
  verifyGithubSignature,
  type GithubPushPayload,
} from '../services/commit-announce.ts';

export const githubRoutes = new Hono<AppEnv>();

/**
 * Receive a GitHub webhook delivery.
 *
 * The raw body must be read before any JSON parsing so the signature covers the
 * exact bytes GitHub signed. Replies stay terse and always 2xx for events we
 * simply ignore, so GitHub doesn't mark the hook as failing.
 */
githubRoutes.post('/webhook', async (c) => {
  const env = loadServerEnv();

  // No secret configured means the endpoint isn't wired up. 501 so it's clearly a
  // config gap, not an auth rejection of a real delivery.
  if (!env.GITHUB_WEBHOOK_SECRET) {
    return c.json({ error: 'GitHub webhook not configured' }, 501);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header('x-hub-signature-256') ?? null;

  const valid = await verifyGithubSignature(env.GITHUB_WEBHOOK_SECRET, signature, rawBody);
  if (!valid) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const event = c.req.header('x-github-event') ?? '';

  // GitHub sends a one-off "ping" when you save the hook. Confirm we're alive.
  if (event === 'ping') {
    return c.json({ ok: true });
  }

  // Everything except pushes is ignored, acknowledged so the hook stays healthy.
  if (event !== 'push') {
    return c.json({ ignored: event });
  }

  const payload = JSON.parse(rawBody) as GithubPushPayload;
  const allowedOrgs = env.GITHUB_COMMIT_ORGS.split(',')
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean);

  const branch = branchToAnnounce(payload, allowedOrgs);
  if (!branch) {
    return c.json({ ignored: 'push' });
  }

  // Build the quip + summary and post as Five in the background; ACK now.
  c.executionCtx.waitUntil(announcePush(env, payload, branch));
  return c.json({ ok: true });
});
