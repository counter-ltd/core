// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * A user's public profile page: their details plus their post timeline.
 *
 * Profile and posts are fetched together so the page renders in one round
 * trip rather than waterfalling one request after the other.
 */
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Page, Post, PublicUser } from '@counter/types';

export const load: PageServerLoad = async ({ params, url, locals, fetch }) => {
  const after = url.searchParams.get('after') ?? undefined;

  // Both calls in parallel: neither depends on the other's result.
  const [profileRes, postsRes] = await Promise.all([
    apiFetch<PublicUser>(`/users/${params.username}`, { token: locals.accessToken, fetch }),
    apiFetch<Page<Post>>(`/users/${params.username}/posts`, {
      query: { after, limit: 20 },
      token: locals.accessToken,
      fetch,
    }),
  ]);

  // The profile is the load-bearing fetch: no user means there's no page to
  // show, so fail hard. Preserve a real 404 (unknown username) but treat any
  // other failure as a 500 so we don't mislabel an outage as "not found".
  if (!profileRes.ok) throw error(profileRes.status === 404 ? 404 : 500, 'User not found');

  return {
    profile: profileRes.data,
    // Posts are secondary: if that call failed we still render the profile
    // header with an empty timeline rather than erroring the whole page.
    posts: postsRes.ok ? postsRes.data : { data: [], nextCursor: null },
  };
};
