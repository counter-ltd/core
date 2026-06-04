// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The server-side gate every request passes through before it reaches a route.
 *
 * Two jobs happen here. First a hand-rolled CSRF check on form posts, because
 * we can't trust SvelteKit's built-in one behind Cloudflare. Second, we turn
 * the session cookies into a logged-in user on `event.locals`, transparently
 * refreshing an expired access token so an active session never gets bounced
 * to the login screen mid-use.
 */
import type { Handle } from '@sveltejs/kit';
import type { PrivateUser, TokenPair } from '@counter/types';
import { apiFetch } from '$lib/server/api';
import {
  readTokens,
  setSessionCookies,
  clearSessionCookies,
} from '$lib/server/session';

// Methods that can't mutate state, so they're exempt from the CSRF check.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// The content types a browser can send from a plain <form> without a preflight.
// Only these can be forged cross-site, so they're the ones worth guarding.
const FORM_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

/**
 * Reject form posts that didn't originate from our own pages.
 *
 * We replace SvelteKit's built-in origin check (turned off in
 * svelte.config.js) because on Cloudflare the Worker can see a different host
 * than the browser submitted to, which makes the built-in check misfire.
 *
 * @returns A 403 response to short-circuit the request, or null to let it
 *          through.
 */
function checkCsrf(event: Parameters<Handle>[0]['event']): Response | null {
  if (SAFE_METHODS.has(event.request.method)) return null;
  const ct = event.request.headers.get('content-type')?.split(';')[0].trim() ?? '';
  if (!FORM_CONTENT_TYPES.includes(ct)) return null;

  const origin = event.request.headers.get('origin');
  // Server-to-server calls don't carry an Origin header, so there's nothing to
  // compare against; let them through.
  if (!origin) return null;

  const host = event.request.headers.get('host') ?? event.url.host;
  const expected = `${event.url.protocol}//${host}`;
  if (origin !== expected) {
    return new Response('Cross-site form submission forbidden', { status: 403 });
  }
  return null;
}

/**
 * Resolve the signed-in user from cookies and hang it on `event.locals` for
 * routes to read.
 *
 * If the access token is missing or expired but a refresh token is still good,
 * we rotate to a fresh pair and re-write the cookies inline, so a logged-in
 * user never gets a spurious logout just because their short-lived access
 * token aged out.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const csrfError = checkCsrf(event);
  if (csrfError) return csrfError;
  event.locals.user = null;
  event.locals.accessToken = null;

  const { accessToken, refreshToken } = readTokens(event.cookies);

  async function loadMe(token: string): Promise<PrivateUser | null> {
    const res = await apiFetch<PrivateUser>('/users/me', { token, fetch: event.fetch });
    return res.ok ? res.data : null;
  }

  if (accessToken) {
    const user = await loadMe(accessToken);
    if (user) {
      event.locals.user = user;
      event.locals.accessToken = accessToken;
    }
  }

  // We only reach for the refresh token if the access token didn't yield a
  // user (absent, expired, or rejected). Refreshing is a network round trip,
  // so we skip it on the happy path.
  if (!event.locals.user && refreshToken) {
    const refreshed = await apiFetch<TokenPair>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      fetch: event.fetch,
    });
    if (refreshed.ok) {
      setSessionCookies(event.cookies, refreshed.data);
      const user = await loadMe(refreshed.data.accessToken);
      if (user) {
        event.locals.user = user;
        event.locals.accessToken = refreshed.data.accessToken;
      }
    } else {
      // The refresh token itself is dead, so the cookies are worthless. Clear
      // them now to stop every later request retrying the same doomed refresh.
      clearSessionCookies(event.cookies);
    }
  }

  return resolve(event);
};
