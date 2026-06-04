import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { TokenPair } from '@counter/types';

export const ACCESS_COOKIE = 'counter_access';
export const REFRESH_COOKIE = 'counter_refresh';

const base = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  // Secure in production (HTTPS); relaxed in local dev so cookies work over http.
  secure: !dev,
};

/** Persist a token pair to httpOnly cookies. Tokens never touch client JS. */
export function setSessionCookies(cookies: Cookies, tokens: TokenPair): void {
  cookies.set(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: 60 * 60 }); // 1h ceiling
  cookies.set(REFRESH_COOKIE, tokens.refreshToken, { ...base, maxAge: 60 * 60 * 24 * 30 });
}

export function clearSessionCookies(cookies: Cookies): void {
  cookies.delete(ACCESS_COOKIE, { path: '/' });
  cookies.delete(REFRESH_COOKIE, { path: '/' });
}

export function readTokens(cookies: Cookies): {
  accessToken: string | null;
  refreshToken: string | null;
} {
  return {
    accessToken: cookies.get(ACCESS_COOKIE) ?? null,
    refreshToken: cookies.get(REFRESH_COOKIE) ?? null,
  };
}
