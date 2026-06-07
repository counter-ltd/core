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
  // Single promise so both derived lists resolve together from one fetch.
  return {
    inbox: apiFetch<Page<Conversation>>('/messages', {
      query: { after, limit: 30 },
      token: locals.accessToken,
      fetch,
    }).then(r => {
      const all = r.ok ? r.data : { data: [] as Conversation[], nextCursor: null };
      // Split into the main inbox (active conversations + requests the viewer
      // sent) and an inbound-requests queue (requests the viewer received).
      return {
        conversations: { data: all.data.filter((c) => !c.isInboundRequest), nextCursor: all.nextCursor },
        requests: { data: all.data.filter((c) => c.isInboundRequest) },
      };
    }),
  };
};
