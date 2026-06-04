import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Page, Theme } from '@counter/types';

export const load: PageServerLoad = async ({ url, locals, fetch }) => {
  const after = url.searchParams.get('after') ?? undefined;
  const res = await apiFetch<Page<Theme>>('/themes', { query: { after, limit: 30 }, fetch });
  return { themes: res.ok ? res.data : { data: [], nextCursor: null } };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();

    const name = String(form.get('name') ?? '').trim();
    const description = String(form.get('description') ?? '').trim() || undefined;
    const variables: Record<string, string> = {
      '--color-bg': String(form.get('bg') ?? '#0a0b0f'),
      '--color-bg-2': String(form.get('bg2') ?? '#0f1117'),
      '--color-text': String(form.get('text') ?? '#e9ebf2'),
      '--color-accent': String(form.get('accent') ?? '#7aa2ff'),
      '--color-accent-2': String(form.get('accent2') ?? '#b48cff'),
    };

    if (!name) return fail(400, { error: 'Give your theme a name.' });

    const res = await apiFetch<Theme>('/themes', {
      method: 'POST',
      token: locals.accessToken,
      body: { name, description, variables, published: true },
    });
    if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Could not publish theme.' });

    throw redirect(303, '/themes');
  },
};
