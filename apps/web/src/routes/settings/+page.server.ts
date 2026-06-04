import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import { clearSessionCookies } from '$lib/server/session';
import type { PrivateUser } from '@counter/types';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  return { profile: locals.user };
};

export const actions: Actions = {
  profile: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();

    const body = {
      displayName: String(form.get('displayName') ?? '').trim() || null,
      bio: String(form.get('bio') ?? '').trim() || null,
      avatarUrl: String(form.get('avatarUrl') ?? '').trim() || null,
    };

    const res = await apiFetch<PrivateUser>('/users/me', {
      method: 'PATCH',
      token: locals.accessToken,
      body,
    });
    if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Could not save.' });
    return { saved: true };
  },

  deleteAccount: async ({ request, locals, cookies }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    if (String(form.get('confirm') ?? '') !== 'DELETE') {
      return fail(400, { error: 'Type DELETE to confirm account deletion.' });
    }
    await apiFetch('/auth/account', { method: 'DELETE', token: locals.accessToken });
    clearSessionCookies(cookies);
    throw redirect(303, '/');
  },
};
