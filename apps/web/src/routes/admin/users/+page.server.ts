// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The admin user list and the moderation actions that act on a row: assigning
 * and removing groups, banning, suspending, and their reversals. The list is
 * filtered server-side from the `?q=` and `?status=` query params so a search
 * is a plain GET that survives a reload.
 *
 * All write actions accept one or more `userId` values so the UI can submit
 * bulk operations for a multi-user selection. `removeGroup` and `resetPassword`
 * are single-user only: the former fires from an inline badge button, the
 * latter produces a per-user link that can't be aggregated.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { AdminUserListItem, AdminGroup, Page } from '@counter/types';

export const load: PageServerLoad = async ({ locals, fetch, url }) => {
  const q = url.searchParams.get('q') ?? '';
  const status = url.searchParams.get('status') ?? '';

  // The group list powers the per-row "add to group" picker. It needs
  // groups.view, which a user-manager might not hold, so treat a failure as
  // "no picker" rather than an error.
  const [usersRes, groupsRes] = await Promise.all([
    apiFetch<Page<AdminUserListItem>>('/admin/users', {
      token: locals.accessToken,
      fetch,
      query: { q: q || undefined, status: status || undefined, limit: 50 },
    }),
    apiFetch<{ data: AdminGroup[] }>('/admin/groups', { token: locals.accessToken, fetch }),
  ]);

  return {
    users: usersRes.ok ? usersRes.data.data : [],
    nextCursor: usersRes.ok ? usersRes.data.nextCursor : null,
    groups: groupsRes.ok ? groupsRes.data.data : [],
    q,
    status,
  };
};

/** Shared tail for every action: surface the API error, or report success. */
function done(res: { ok: boolean; status: number; error: { message: string } | null }) {
  if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Action failed.' });
  return { saved: true };
}

export const actions: Actions = {
  addGroup: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const userIds = form.getAll('userId').map(String).filter(Boolean);
    const groupId = String(form.get('groupId'));
    if (!groupId) return fail(400, { error: 'Pick a group first.' });
    for (const userId of userIds) {
      const res = await apiFetch(`/admin/users/${userId}/groups`, {
        method: 'POST',
        token: locals.accessToken,
        body: { groupId },
      });
      if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Action failed.' });
    }
    return { saved: true };
  },

  removeGroup: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const userId = String(form.get('userId'));
    const groupId = String(form.get('groupId'));
    return done(
      await apiFetch(`/admin/users/${userId}/groups/${groupId}`, {
        method: 'DELETE',
        token: locals.accessToken,
      }),
    );
  },

  ban: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const userIds = form.getAll('userId').map(String).filter(Boolean);
    const reason = String(form.get('reason') ?? '').trim() || null;
    for (const userId of userIds) {
      const res = await apiFetch(`/admin/users/${userId}/ban`, {
        method: 'POST',
        token: locals.accessToken,
        body: { reason },
      });
      if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Action failed.' });
    }
    return { saved: true };
  },

  unban: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const userIds = (await request.formData()).getAll('userId').map(String).filter(Boolean);
    for (const userId of userIds) {
      const res = await apiFetch(`/admin/users/${userId}/unban`, {
        method: 'POST',
        token: locals.accessToken,
      });
      if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Action failed.' });
    }
    return { saved: true };
  },

  suspend: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const userIds = form.getAll('userId').map(String).filter(Boolean);
    const until = String(form.get('until') ?? '').trim();
    const reason = String(form.get('reason') ?? '').trim() || null;
    if (!until) return fail(400, { error: 'Pick an end time.' });
    // The datetime-local input has no zone; treat it as the admin's local time
    // and hand the API a full ISO string with offset.
    const iso = new Date(until).toISOString();
    for (const userId of userIds) {
      const res = await apiFetch(`/admin/users/${userId}/suspend`, {
        method: 'POST',
        token: locals.accessToken,
        body: { until: iso, reason },
      });
      if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Action failed.' });
    }
    return { saved: true };
  },

  unsuspend: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const userIds = (await request.formData()).getAll('userId').map(String).filter(Boolean);
    for (const userId of userIds) {
      const res = await apiFetch(`/admin/users/${userId}/unsuspend`, {
        method: 'POST',
        token: locals.accessToken,
      });
      if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Action failed.' });
    }
    return { saved: true };
  },

  // Trigger a password reset for a single user. `delivery` is 'email' (mail the
  // user a link) or 'link' (get the URL back to hand over directly). Bulk reset
  // isn't supported — the link delivery produces a per-user URL that can't be
  // aggregated into one response, so this action always takes a single userId.
  resetPassword: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const userId = String(form.get('userId'));
    const delivery = String(form.get('delivery')) === 'link' ? 'link' : 'email';
    const res = await apiFetch<{ ok: boolean; link: string | null }>(
      `/admin/users/${userId}/password-reset`,
      { method: 'POST', token: locals.accessToken, body: { delivery } },
    );
    if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Action failed.' });
    return { saved: true, resetLink: res.data.link ?? null };
  },
};
