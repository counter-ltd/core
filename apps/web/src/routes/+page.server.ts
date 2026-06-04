// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The public landing feed, what logged-out visitors see at the root URL.
 *
 * Pulls the global `/posts/public` timeline. There's no auth gate here: the
 * page is meant to work for everyone, signed in or not.
 */
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Page, Post } from '@counter/types';

export const load: PageServerLoad = async ({ url, locals, fetch }) => {
  // Cursor-paginated: `?after=<cursor>` carries the previous page's nextCursor.
  // Absent on the first load, so coerce the empty string to undefined.
  const after = url.searchParams.get('after') ?? undefined;
  const res = await apiFetch<Page<Post>>('/posts/public', {
    query: { after, limit: 20 },
    // Token is optional here, but passing it lets the API personalise viewer
    // state (liked/reposted flags) when the visitor happens to be signed in.
    token: locals.accessToken,
    fetch,
  });
  return {
    // Fall back to an empty page rather than throwing: a broken API shouldn't
    // take down the landing page, just leave it empty.
    feed: res.ok ? res.data : { data: [], nextCursor: null },
  };
};
