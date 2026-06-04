// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The notifications page: the viewer's notification list, plus a "mark all
 * read" action.
 *
 * Notifications are personal, so the whole page is behind a login check.
 */
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Notification, Page } from '@counter/types';

export const load: PageServerLoad = async ({ url, locals, fetch }) => {
  if (!locals.user) throw redirect(303, '/login');
  const after = url.searchParams.get('after') ?? undefined;
  const res = await apiFetch<Page<Notification>>('/notifications', {
    query: { after, limit: 30 },
    token: locals.accessToken,
    fetch,
  });
  return { notifications: res.ok ? res.data : { data: [], nextCursor: null } };
};

export const actions: Actions = {
  readAll: async ({ locals }) => {
    // Skip the API call when there's no token rather than erroring; either way
    // we end on the notifications page, now refreshed with everything marked
    // read. The redirect also clears the form POST so a refresh won't re-fire.
    if (locals.accessToken) {
      await apiFetch('/notifications/read', { method: 'POST', token: locals.accessToken });
    }
    throw redirect(303, '/notifications');
  },
};
