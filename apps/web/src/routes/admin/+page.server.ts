// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The admin dashboard load: site-wide counts for the landing page. Gated on
 * `dashboard.view`; without it the page renders a short "no access" note rather
 * than calling an endpoint that would 403.
 */
import type { PageServerLoad } from './$types';
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
