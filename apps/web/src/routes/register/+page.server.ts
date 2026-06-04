import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import { setSessionCookies } from '$lib/server/session';
import type { AuthResponse } from '@counter/types';

export const load: PageServerLoad = ({ locals }) => {
  if (locals.user) throw redirect(303, '/feed');
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    const username = String(form.get('username') ?? '').trim().toLowerCase();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const displayName = String(form.get('displayName') ?? '').trim() || undefined;

    const values = { username, email, displayName: displayName ?? '' };

    if (!username || !email || !password) {
      return fail(400, { ...values, error: 'Username, email and password are required.' });
    }

    const res = await apiFetch<AuthResponse>('/auth/register', {
      method: 'POST',
      body: { username, email, password, displayName },
    });

    if (!res.ok) {
      return fail(res.status, { ...values, error: res.error?.message ?? 'Could not create account.' });
    }

    setSessionCookies(cookies, res.data);
    throw redirect(303, '/feed');
  },
};
