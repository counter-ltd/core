// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * OAuth login callback landing page.
 *
 * The provider redirect goes to counter.ltd/auth/[provider]/callback (a proxy
 * route), which forwards code and state to the API. On success the API issues
 * a short-lived session code and redirects here with ?provider=X&code=Y.
 *
 * This load function exchanges that code for a real JWT pair on the server,
 * sets the session cookies, and redirects to the feed. The code never touches
 * client-side JS, so live tokens are never in the browser URL or console.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import { setActiveAccount } from '$lib/server/session';
import type { AuthResponse } from '@counter/types';

export const load: PageServerLoad = async ({ url, cookies, fetch }) => {
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) return { error };
  if (!code) return { error: 'No session code received.' };

  const res = await apiFetch<AuthResponse>('/auth/session/exchange', {
    method: 'POST',
    body: { code },
    fetch,
  });

  if (!res.ok) {
    return { error: res.error?.message ?? 'Sign-in failed. Please try again.' };
  }

  setActiveAccount(cookies, res.data, res.data.user);
  redirect(303, '/');
};
