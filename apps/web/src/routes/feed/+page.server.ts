// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The signed-in following feed at /feed.
 *
 * Unlike the public landing page, this is plain reverse-chronological, no
 * ranking. Topics are fetched in parallel to power the Composer's topic
 * selector, so posting into a topic doesn't require a separate round-trip.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Page, Post, Topic } from '@counter/types';

export const load: PageServerLoad = async ({ url, locals, fetch }) => {
  if (!locals.user) throw redirect(303, '/login');

  // Cursor-paginated: `?after=<cursor>` carries the previous page's nextCursor.
  // Absent on the first load, so coerce the empty string to undefined.
  const after = url.searchParams.get('after') ?? undefined;
  // Return promises so the shell renders immediately and content streams in.
  return {
    feed: apiFetch<Page<Post>>('/posts', {
      query: { after, limit: 20 },
      token: locals.accessToken,
      fetch,
    }).then(r => r.ok ? r.data : { data: [] as Post[], nextCursor: null }),
    topics: apiFetch<{ data: Topic[]; nextCursor: string | null }>('/topics', {
      token: locals.accessToken,
      fetch,
    }).then(r => r.ok ? r.data.data : [] as Topic[]),
  };
};
