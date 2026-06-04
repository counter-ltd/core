// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The "create a topic" form at /topics/new.
 *
 * The load just guards the route — only signed-in users can create topics, so
 * logged-out visitors get bounced to login. The form action does the real work:
 * slugify, validate via the API, and redirect to the new topic on success.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Topic } from '@counter/types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  return {};
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');

    const form = await request.formData();
    // Slugify on the client side before sending so the user sees the
    // normalised slug in the error echoes without a round-trip.
    const slug = String(form.get('slug') ?? '').trim().toLowerCase();
    const name = String(form.get('name') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();

    const res = await apiFetch<Topic>('/topics', {
      method: 'POST',
      token: locals.accessToken,
      // Description is optional; skip the key entirely rather than sending an
      // empty string so the API can use its own default-or-null logic.
      body: { slug, name, description: description || undefined },
    });

    if (!res.ok) {
      // Echo the form values back so the user doesn't have to retype on error.
      return fail(res.status, {
        error: res.error?.message ?? 'Failed to create topic',
        slug,
        name,
        description,
      });
    }

    throw redirect(303, `/topics/${res.data.slug}`);
  },
};
