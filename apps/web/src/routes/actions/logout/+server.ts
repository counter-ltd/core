import { redirect, type RequestHandler } from '@sveltejs/kit';
import { apiFetch } from '$lib/server/api';
import { readTokens, clearSessionCookies } from '$lib/server/session';

export const POST: RequestHandler = async ({ cookies }) => {
  const { refreshToken } = readTokens(cookies);
  if (refreshToken) {
    await apiFetch('/auth/logout', { method: 'POST', body: { refreshToken } });
  }
  clearSessionCookies(cookies);
  throw redirect(303, '/');
};
