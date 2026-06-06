// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * A hashtag's page: every post carrying that tag, newest-first.
 *
 * Tags aren't topics. A '#foo' in a post body is just a label, so this page
 * has no header metadata, no membership, and no join button, only the feed.
 * It deliberately never 404s on an unused tag: a reader who clicks '#foo' from
 * a post body expects to land somewhere, so an unknown tag shows an empty feed
 * rather than the error page topics give for a bad slug.
 */
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Page, Post } from '@counter/types';

export const load: PageServerLoad = async ({ params, url, locals, fetch }) => {
  // Mirror the API's normalisation so the title matches whatever the feed
  // actually queries: strip a stray leading '#' and lowercase.
  const tag = params.tag.replace(/^#/, '').toLowerCase();
  const after = url.searchParams.get('after') ?? undefined;

  const postsRes = await apiFetch<Page<Post>>(`/tags/${tag}`, {
    query: { after, limit: 20 },
    token: locals.accessToken,
    fetch,
  });

  return {
    tag,
    // A 404 from the API (unknown tag) degrades to an empty feed, not an error.
    feed: postsRes.ok ? postsRes.data : { data: [], nextCursor: null },
  };
};
