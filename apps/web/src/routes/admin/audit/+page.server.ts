// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The audit log load: the most recent admin actions, newest first. Read-only;
 * the log has no write path from the UI. Gated by the API on `audit.view`.
 */
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { AuditEntry, Page } from '@counter/types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
  const res = await apiFetch<Page<AuditEntry>>('/admin/audit', {
    token: locals.accessToken,
    fetch,
    query: { limit: 100 },
  });
  return { entries: res.ok ? res.data.data : [] };
};
