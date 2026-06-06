// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Link preview proxy: fetches OG/meta tags for a given URL server-side so the
 * client avoids CORS issues and the user's IP never reaches the target site.
 *
 * Auth is required to prevent unauthenticated use of the Worker as a free proxy.
 */
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.ts';
import { fetchLinkPreview } from '../lib/link-preview.ts';
import type { AppEnv } from '../types.ts';

/** Hono router mounted at `/preview` by the main app. */
export const previewRoutes = new Hono<AppEnv>();

previewRoutes.get('/', requireAuth, async (c) => {
  const rawUrl = c.req.query('url');
  if (!rawUrl) {
    return c.json({ error: { code: 'bad_request', message: 'url is required' } }, 400);
  }

  let url: string;
  try {
    url = decodeURIComponent(rawUrl);
    // fetchLinkPreview trusts its input, so reject unparseable values here.
    new URL(url);
  } catch {
    return c.json({ error: { code: 'bad_request', message: 'Invalid URL' } }, 400);
  }

  const preview = await fetchLinkPreview(url);
  if (!preview) {
    return c.json({ error: { code: 'not_found', message: 'Could not fetch preview' } }, 404);
  }

  return c.json(preview);
});
