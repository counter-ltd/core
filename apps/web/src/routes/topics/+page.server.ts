// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The topics directory: list every topic, create a new one, or join/leave one.
 *
 * Listing is open to everyone; creating and joining need a signed-in user. The
 * `join` action doubles as leave, driven by the form's `leaving` flag.
 */
import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Topic } from '@counter/types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
  const res = await apiFetch<{ data: Topic[]; nextCursor: string | null }>('/topics', {
    // Token is optional but lets the API mark which topics the viewer is in.
    token: locals.accessToken,
    fetch,
  });
  // Unwrap to the bare list: this page shows all topics without paging.
  return { topics: res.ok ? res.data.data : [] };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');

    const form = await request.formData();
    // Slug is lowercased so it's canonical and case-insensitive in URLs.
    const slug = String(form.get('slug') ?? '').trim().toLowerCase();
    const name = String(form.get('name') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();

    const res = await apiFetch<Topic>('/topics', {
      method: 'POST',
      token: locals.accessToken,
      // Send undefined for a blank description so we omit it rather than
      // creating the topic with an empty one.
      body: { slug, name, description: description || undefined },
    });

    // On failure echo the typed fields back alongside the error so the create
    // form re-renders with the user's input intact.
    if (!res.ok) {
      return fail(res.status, { error: res.error?.message ?? 'Failed to create topic', slug, name, description });
    }

    // Straight to the new topic's page on success.
    throw redirect(303, `/topics/${res.data.slug}`);
  },

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
