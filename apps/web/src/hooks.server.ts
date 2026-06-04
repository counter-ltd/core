import type { Handle } from '@sveltejs/kit';
import type { PrivateUser, TokenPair } from '@counter/types';
import { apiFetch } from '$lib/server/api';
import {
  readTokens,
  setSessionCookies,
  clearSessionCookies,
} from '$lib/server/session';

/**
 * Resolve the current user from cookies on every request. If the access token
 * is expired but a refresh token is present, transparently refresh and update
 * cookies — so a logged-in user never sees a spurious logout mid-session.
 */
export const handle: Handle = async ({ event, resolve }) => {
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

  // Access token missing/expired but we have a refresh token → rotate.
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
      clearSessionCookies(event.cookies);
    }
  }

  return resolve(event);
};
