// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Group and permission management: list every group, create a new one, edit an
 * existing one's metadata and permission set, and delete non-system groups.
 *
 * The permission checklist is built client-side from the shared catalogue in
 * @counter/config, so the load only needs the groups themselves. Each write
 * action collects the ticked permission keys with `getAll('permissions')` and
 * forwards them to the API, which validates them against the same enum.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { AdminGroup } from '@counter/types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
  const res = await apiFetch<{ data: AdminGroup[] }>('/admin/groups', {
    token: locals.accessToken,
    fetch,
  });
  return { groups: res.ok ? res.data.data : [] };
};

/** Surface an API failure as a form error, or flag success. */
function done(res: { ok: boolean; status: number; error: { message: string } | null }) {
  if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Action failed.' });
  return { saved: true };
}

export const actions: Actions = {
  create: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const body = {
      slug: String(form.get('slug') ?? '').trim(),
      name: String(form.get('name') ?? '').trim(),
      description: String(form.get('description') ?? '').trim() || null,
      color: String(form.get('color') ?? '').trim() || null,
      permissions: form.getAll('permissions').map(String),
    };
    if (!body.slug || !body.name) return fail(400, { error: 'Slug and name are required.' });
    return done(
      await apiFetch('/admin/groups', { method: 'POST', token: locals.accessToken, body }),
    );
  },

  update: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('groupId'));
    const body = {
      name: String(form.get('name') ?? '').trim(),
      description: String(form.get('description') ?? '').trim() || null,
      color: String(form.get('color') ?? '').trim() || null,
      permissions: form.getAll('permissions').map(String),
    };
    return done(
      await apiFetch(`/admin/groups/${id}`, { method: 'PATCH', token: locals.accessToken, body }),
    );
  },

  remove: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const id = String((await request.formData()).get('groupId'));
    return done(
      await apiFetch(`/admin/groups/${id}`, { method: 'DELETE', token: locals.accessToken }),
    );
  },
};
