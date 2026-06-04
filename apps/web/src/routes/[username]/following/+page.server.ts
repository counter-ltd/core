// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The list of accounts a given user follows.
 *
 * Mirror of the "followers" route: same response shape, same shared Svelte
 * page, with `kind` set to 'following' so the view labels itself correctly.
 */
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Page, PublicUser } from '@counter/types';

export const load: PageServerLoad = async ({ params, url, locals, fetch }) => {
  const after = url.searchParams.get('after') ?? undefined;
  const res = await apiFetch<Page<PublicUser>>(`/users/${params.username}/following`, {
    query: { after, limit: 30 },
    token: locals.accessToken,
    fetch,
  });
  // Same split as followers: a real 404 for an unknown user, 500 otherwise.
  if (!res.ok) throw error(res.status === 404 ? 404 : 500, 'Not found');
  return { username: params.username, kind: 'following' as const, list: res.data };
};
