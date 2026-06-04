// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The signed-in home feed: the personalised, algorithm-ranked timeline.
 *
 * This is the logged-in counterpart to the public landing feed. It hits the
 * authenticated `/posts` endpoint and is gated behind a login check.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Page, Post } from '@counter/types';

export const load: PageServerLoad = async ({ url, locals, fetch }) => {
  // The personalised feed only makes sense for a known user; anonymous visitors
  // belong on the public landing page, reached via login.
  if (!locals.user) throw redirect(303, '/login');

  const after = url.searchParams.get('after') ?? undefined;
  const res = await apiFetch<Page<Post>>('/posts', {
    query: { after, limit: 20 },
    token: locals.accessToken,
    fetch,
  });
  // Empty-page fallback keeps the feed shell rendering if the call fails.
  return { feed: res.ok ? res.data : { data: [], nextCursor: null } };
};
