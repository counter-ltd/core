// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The admin dashboard load: site-wide counts for the landing page. Gated on
 * `dashboard.view`; without it the page renders a short "no access" note rather
 * than calling an endpoint that would 403.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { DashboardStats } from '@counter/types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
  if (!locals.user?.permissions.includes('dashboard.view')) {
    return { stats: null };
  }
  const res = await apiFetch<DashboardStats>('/admin/dashboard', {
    token: locals.accessToken,
    fetch,
  });
  return { stats: res.ok ? res.data : null };
};

export const actions: Actions = {
  // Re-push Thing Two's Discord slash commands using the API's own secrets, so
  // the command list refreshes without a bot token on anyone's machine. Gated
  // server-side on groups.manage; the button is only shown to those who have it.
  registerCommands: async ({ locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const res = await apiFetch<{ ok: boolean; scope: string }>(
      '/admin/discord/register-commands',
      { method: 'POST', token: locals.accessToken },
    );
    if (!res.ok) {
      return fail(res.status, { error: res.error?.message ?? 'Registration failed.' });
    }
    return { registered: true, scope: res.data.scope };
  },
};
