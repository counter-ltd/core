// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Lands the email-verification link. The token rides in `?token=`; we redeem it
 * against the API and hand the page a simple status so it can say it worked or
 * the link was stale. No login required, the token is the credential, so an
 * expired session doesn't get in the way of clicking a link from an inbox.
 */
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';

export const load: PageServerLoad = async ({ url, fetch }) => {
  const token = url.searchParams.get('token');
  if (!token) return { status: 'missing' as const };

  const res = await apiFetch('/auth/verify', { method: 'POST', body: { token }, fetch });
  return { status: res.ok ? ('ok' as const) : ('invalid' as const) };
};
