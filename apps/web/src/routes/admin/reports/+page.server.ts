// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The moderation queue: the report list (filtered by `?status=`, defaulting to
 * open) plus the actions that close a report or act on what it points at. A
 * caller who also holds `posts.moderate` can remove the reported post inline; the
 * resolve action needs `reports.resolve`. The API enforces both.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { AdminReport, Page } from '@counter/types';

export const load: PageServerLoad = async ({ locals, fetch, url }) => {
  const status = url.searchParams.get('status') ?? 'open';
  const res = await apiFetch<Page<AdminReport>>('/admin/reports', {
    token: locals.accessToken,
    fetch,
    query: { status, limit: 50 },
  });
  return {
    reports: res.ok ? res.data.data : [],
    status,
  };
};

/** Surface an API failure as a form error, or flag success. */
function done(res: { ok: boolean; status: number; error: { message: string } | null }) {
  if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Action failed.' });
  return { saved: true };
}

export const actions: Actions = {
  resolve: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('reportId'));
    const status = String(form.get('status'));
    return done(
      await apiFetch(`/admin/reports/${id}/resolve`, {
        method: 'POST',
        token: locals.accessToken,
        body: { status },
      }),
    );
  },

  removePost: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const postId = String((await request.formData()).get('postId'));
    return done(
      await apiFetch(`/admin/posts/${postId}`, { method: 'DELETE', token: locals.accessToken }),
    );
  },
};
