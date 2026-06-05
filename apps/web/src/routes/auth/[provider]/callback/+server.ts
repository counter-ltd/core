// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * OAuth provider callback proxy.
 *
 * GitHub and Discord redirect back to counter.ltd (this route) after the user
 * approves or declines. We forward the code and state params to the API, which
 * handles the token exchange, finds or creates the Counter user, and issues its
 * own redirect back into the app. We pass that redirect straight through.
 *
 * Keeping the callback on counter.ltd rather than api.counter.ltd means the
 * redirect URI registered with each provider is a clean main-domain URL, and
 * any future server-side session handling the web app needs can hook in here.
 */
import { env } from '$env/dynamic/public';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, params, fetch }) => {
  const apiUrl = env.PUBLIC_API_URL || 'http://localhost:3000';
  const provider = params.provider;

  // Forward the provider's query params (code, state, error) to the API callback.
  const apiCallback = `${apiUrl}/auth/${provider}/callback?${url.searchParams}`;

  // Fetch without following redirects so we can pass the API's 302 straight to
  // the browser. The API always redirects on both success and error paths.
  const res = await fetch(apiCallback, { redirect: 'manual' });

  const location = res.headers.get('location');
  if (location) {
    return new Response(null, { status: 302, headers: { Location: location } });
  }

  // The API should always redirect; a non-redirect response is unexpected.
  return new Response(null, { status: 302, headers: { Location: '/auth/callback?error=OAuth+failed' } });
};
