// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The topics directory: list every topic, create a new one, or join/leave one.
 *
 * Listing is open to everyone; creating and joining need a signed-in user. The
 * `join` action doubles as leave, driven by the form's `leaving` flag.
 */
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Topic } from '@counter/types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
  return {
    topics: apiFetch<{ data: Topic[]; nextCursor: string | null }>('/topics', {
      token: locals.accessToken,
      fetch,
    }).then(r => r.ok ? r.data.data : [] as Topic[]),
  };
};

export const actions: Actions = {
  join: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const slug = String(form.get('slug') ?? '');
    // The form tells us the current state: `leaving=true` means the user is
    // already a member, so this click is a leave (DELETE) rather than a join.
    const leaving = form.get('leaving') === 'true';

    await apiFetch(`/topics/${slug}/join`, {
      method: leaving ? 'DELETE' : 'POST',
      token: locals.accessToken,
    });

    // No redirect here: this action is for the in-page (enhanced) toggle, which
    // just needs the ok flag and updates membership without a full navigation.
    return { ok: true };
  },
};
