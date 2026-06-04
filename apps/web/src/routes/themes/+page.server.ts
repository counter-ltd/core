// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The themes gallery: browse community themes, and publish your own.
 *
 * Browsing is public (no token on the load), but the `create` action needs a
 * signed-in user. A theme is just a name plus a set of CSS custom-property
 * values the front end applies.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Page, Theme } from '@counter/types';

export const load: PageServerLoad = async ({ url, locals, fetch }) => {
  const after = url.searchParams.get('after') ?? undefined;
  // Public listing, so no token: anyone can browse the gallery.
  const res = await apiFetch<Page<Theme>>('/themes', { query: { after, limit: 30 }, fetch });
  return { themes: res.ok ? res.data : { data: [], nextCursor: null } };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();

    const name = String(form.get('name') ?? '').trim();
    const description = String(form.get('description') ?? '').trim() || undefined;
    // Map each colour field onto the CSS custom property it drives, falling
    // back to the default palette when a field is left blank so a partial
    // submission still yields a complete, usable theme.
    const variables: Record<string, string> = {
      '--color-bg': String(form.get('bg') ?? '#0a0b0f'),
      '--color-bg-2': String(form.get('bg2') ?? '#0f1117'),
      '--color-text': String(form.get('text') ?? '#e9ebf2'),
      '--color-accent': String(form.get('accent') ?? '#7aa2ff'),
      '--color-accent-2': String(form.get('accent2') ?? '#b48cff'),
    };

    if (!name) return fail(400, { error: 'Give your theme a name.' });

    const res = await apiFetch<Theme>('/themes', {
      method: 'POST',
      token: locals.accessToken,
      // Published straight away; there's no draft state in this flow.
      body: { name, description, variables, published: true },
    });
    if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Could not publish theme.' });

    // Back to the gallery so the author sees their new theme in the list.
    throw redirect(303, '/themes');
  },
};
