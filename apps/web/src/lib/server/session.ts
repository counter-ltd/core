// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Where the login tokens live: httpOnly cookies, read and written only on the
 * server.
 *
 * Keeping the access and refresh tokens in httpOnly cookies (never in JS-visible
 * storage) means a XSS bug on the page can't read them. The trade-off is that
 * only server code, the hooks and load functions, can touch a session, which is
 * exactly where we want that authority to sit.
 */
import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { TokenPair } from '@counter/types';

export const ACCESS_COOKIE = 'counter_access';
export const REFRESH_COOKIE = 'counter_refresh';

// Shared attributes for both cookies. `sameSite: 'lax'` blocks the cookie on
// cross-site POSTs (a CSRF backstop) while still sending it on top-level
// navigations into the app.
const base = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  // HTTPS-only in production. Relaxed in dev so cookies still work over plain
  // http://localhost, where there's no TLS.
  secure: !dev,
};

/**
 * Write a fresh access/refresh pair into the session cookies, overwriting any
 * existing ones. Call this on login and after every token rotation.
 */
export function setSessionCookies(cookies: Cookies, tokens: TokenPair): void {
  // The access cookie's maxAge is a hard ceiling, not the token's real
  // lifetime; the JWT carries its own (shorter) exp. The refresh cookie lasts
  // 30 days, which sets the outer bound on "stay logged in".
  cookies.set(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: 60 * 60 });
  cookies.set(REFRESH_COOKIE, tokens.refreshToken, { ...base, maxAge: 60 * 60 * 24 * 30 });
}

/** Drop both session cookies. Used on logout and when a refresh token is rejected. */
export function clearSessionCookies(cookies: Cookies): void {
  // Delete has to repeat the path the cookie was set with, or the browser
  // treats it as a different cookie and the original survives.
  cookies.delete(ACCESS_COOKIE, { path: '/' });
  cookies.delete(REFRESH_COOKIE, { path: '/' });
}

/** Pull both tokens out of the request cookies, each null when absent. */
export function readTokens(cookies: Cookies): {
  accessToken: string | null;
  refreshToken: string | null;
} {
  return {
    accessToken: cookies.get(ACCESS_COOKIE) ?? null,
    refreshToken: cookies.get(REFRESH_COOKIE) ?? null,
  };
}
