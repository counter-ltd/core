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
    const identifier = String(form.get('identifier') ?? '').trim();
    const password = String(form.get('password') ?? '');

    if (!identifier || !password) {
      return fail(400, { identifier, error: 'Enter your username/email and password.' });
    }

    const res = await apiFetch<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { identifier, password },
    });

    if (!res.ok) {
      return fail(res.status, { identifier, error: res.error?.message ?? 'Login failed.' });
    }

    setSessionCookies(cookies, res.data);
    throw redirect(303, '/feed');
  },
};
