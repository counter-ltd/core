// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The themes page, split into Library, Browse, and Create.
 *
 * Browse is the public published gallery (no token). Library is the signed-in
 * user's own themes plus the ones they've saved, so it only loads with a token.
 * A theme itself is just a name plus a map of CSS custom-property values the
 * front end applies; "applying" stays a per-device client action, what the
 * server tracks is which themes you own and which you've saved.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import { defaultThemeVars, expandThemeVars } from '$lib/theme';
import type { Page, Theme, ThemeLibrary } from '@counter/types';

export const load: PageServerLoad = async ({ url, locals, fetch }) => {
  const after = url.searchParams.get('after') ?? undefined;

  // Browse is public, so no token: anyone can see the published gallery.
  const browseRes = await apiFetch<Page<Theme>>('/themes', {
    query: { after, limit: 30 },
    fetch,
  });
  const browse = browseRes.ok ? browseRes.data : { data: [], nextCursor: null };

  // Library needs auth. Logged-out visitors get an empty one and the page hides
  // the tab's actions rather than calling an endpoint that would 401.
  let library: ThemeLibrary = { created: [], saved: [] };
  if (locals.accessToken) {
    const libRes = await apiFetch<ThemeLibrary>('/themes/library', {
      token: locals.accessToken,
      fetch,
    });
    if (libRes.ok) library = libRes.data;
  }

  return { browse, library };
};

/**
 * Build the full variable map from a submitted editor form.
 *
 * The editor posts a hidden input per token (colours and style knobs alike), all
 * named `--something`, so we take every `--` field generically rather than
 * enumerate keys here. Defaults fill anything the form omits, then
 * `expandThemeVars` derives the tokens the CSS needs (font stacks, the radius
 * scale) so the stored theme is self-contained.
 */
function readVariables(form: FormData): Record<string, string> {
  const variables = defaultThemeVars();
  for (const [key, value] of form.entries()) {
    if (key.startsWith('--') && typeof value === 'string') variables[key] = value;
  }
  return expandThemeVars(variables);
}

export const actions: Actions = {
  // Create a theme from the editor. The clicked button decides whether it goes
  // straight to the public gallery (published) or stays a private draft that
  // only shows in the author's Library.
  create: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();

    const name = String(form.get('name') ?? '').trim();
    const description = String(form.get('description') ?? '').trim() || undefined;
    const published = form.get('published') === 'true';
    const variables = readVariables(form);

    if (!name) return fail(400, { error: 'Give your theme a name.' });

    const res = await apiFetch<Theme>('/themes', {
      method: 'POST',
      token: locals.accessToken,
      body: { name, description, variables, published },
    });
    if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Could not save theme.' });

    throw redirect(303, '/themes');
  },

  // Edit one of your own themes. Sends the same colour map and metadata as
  // create, plus the id, to PATCH /themes/:id. The clicked button still decides
  // published, so editing can flip a draft public or pull a theme back private.
  update: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();

    const id = String(form.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing theme.' });

    const name = String(form.get('name') ?? '').trim();
    const description = String(form.get('description') ?? '').trim() || null;
    const published = form.get('published') === 'true';
    const variables = readVariables(form);

    if (!name) return fail(400, { error: 'Give your theme a name.' });

    const res = await apiFetch<Theme>(`/themes/${id}`, {
      method: 'PATCH',
      token: locals.accessToken,
      body: { name, description, variables, published },
    });
    if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Could not save theme.' });

    throw redirect(303, '/themes');
  },

  // Save someone else's published theme into your Library.
  save: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing theme.' });

    const res = await apiFetch(`/themes/${id}/save`, {
      method: 'POST',
      token: locals.accessToken,
    });
    if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Could not save theme.' });

    throw redirect(303, '/themes');
  },

  // Remove a theme from your Library (the theme itself is untouched).
  unsave: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing theme.' });

    const res = await apiFetch(`/themes/${id}/save`, {
      method: 'DELETE',
      token: locals.accessToken,
    });
    if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Could not unsave theme.' });

    throw redirect(303, '/themes');
  },

  // Delete one of your own themes. Owner-only on the API side; a non-owner gets
  // a 403 surfaced as the form error.
  delete: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing theme.' });

    const res = await apiFetch(`/themes/${id}`, {
      method: 'DELETE',
      token: locals.accessToken,
    });
    if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Could not delete theme.' });

    throw redirect(303, '/themes');
  },
};
