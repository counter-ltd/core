import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Notification, Page } from '@counter/types';

export const load: PageServerLoad = async ({ url, locals, fetch }) => {
  if (!locals.user) throw redirect(303, '/login');
  const after = url.searchParams.get('after') ?? undefined;
  const res = await apiFetch<Page<Notification>>('/notifications', {
    query: { after, limit: 30 },
    token: locals.accessToken,
    fetch,
  });
  return { notifications: res.ok ? res.data : { data: [], nextCursor: null } };
};

export const actions: Actions = {
  readAll: async ({ locals }) => {
    if (locals.accessToken) {
      await apiFetch('/notifications/read', { method: 'POST', token: locals.accessToken });
    }
    throw redirect(303, '/notifications');
  },
};
