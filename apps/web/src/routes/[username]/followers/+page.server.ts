// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The list of accounts following a given user.
 *
 * Shares a Svelte page with the "following" route; both hand back the same
 * shape and a `kind` discriminator so the view can label itself correctly.
 */
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Page, PublicUser } from '@counter/types';

export const load: PageServerLoad = async ({ params, url, locals, fetch }) => {
  const after = url.searchParams.get('after') ?? undefined;
  const res = await apiFetch<Page<PublicUser>>(`/users/${params.username}/followers`, {
    query: { after, limit: 30 },
    token: locals.accessToken,
    fetch,
  });
  // No graceful fallback here: an unknown username is a genuine 404, anything
  // else a 500. Keep the two apart so an outage isn't shown as a missing user.
  if (!res.ok) throw error(res.status === 404 ? 404 : 500, 'Not found');
  // `kind` lets the shared followers/following page tell the two views apart.
  return { username: params.username, kind: 'followers' as const, list: res.data };
};
