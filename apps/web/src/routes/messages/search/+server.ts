// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Thin proxy for user search in the "new message" dialog.
 *
 * The client can't call the API directly with auth (tokens live in httpOnly
 * cookies), so it fetches here and this handler forwards with the session
 * token. Returns a Page<PublicUser> shaped response.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { apiFetch } from '$lib/server/api';
import type { Page, PublicUser } from '@counter/types';

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.accessToken) return json({ data: [], nextCursor: null }, { status: 401 });

  const q = url.searchParams.get('q')?.trim() ?? '';
  if (!q) return json({ data: [], nextCursor: null });

  const res = await apiFetch<Page<PublicUser>>('/search/users', {
    query: { q, limit: 20 },
    token: locals.accessToken,
  });

  return json(res.ok ? res.data : { data: [], nextCursor: null });
};
