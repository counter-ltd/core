// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The messages inbox: all conversations for the signed-in user, ordered by
 * most recent activity. Logged-in only.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Conversation, Page } from '@counter/types';

export const load: PageServerLoad = async ({ url, locals, fetch }) => {
  if (!locals.user) throw redirect(303, '/login');

  const after = url.searchParams.get('after') ?? undefined;
  const res = await apiFetch<Page<Conversation>>('/messages', {
    query: { after, limit: 30 },
    token: locals.accessToken,
    fetch,
  });

  return { conversations: res.ok ? res.data : { data: [], nextCursor: null } };
};
