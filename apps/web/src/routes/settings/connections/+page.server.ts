// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Connections section: OAuth-linked accounts (GitHub, Discord) and the
 * rel="me" verified links that earn profile badges. The OAuth connect flow
 * lands the browser back here with ?connected or ?oauthError (see the API's
 * connectRedirect), so this is the page those params are read on.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type {
  Integration,
  OAuthConnectedAccount,
  OAuthConnectPrepareResponse,
} from '@counter/types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
  if (!locals.user) throw redirect(303, '/login');
  // Only the three things this section renders; each falls back to a safe empty
  // value so a single failed fetch can't blank the whole page.
  const [links, githubRes, discordRes] = await Promise.all([
    apiFetch<Integration[]>('/integrations/me', { token: locals.accessToken, fetch }),
    // 404 means not connected — treat as null, not an error.
    apiFetch<OAuthConnectedAccount>('/auth/github/me', { token: locals.accessToken, fetch }),
    apiFetch<OAuthConnectedAccount>('/auth/discord/me', { token: locals.accessToken, fetch }),
  ]);
  return {
    profile: locals.user,
    links: links.ok ? links.data : [],
    githubAccount: githubRes.ok ? githubRes.data : null,
    discordAccount: discordRes.ok ? discordRes.data : null,
  };
};

export const actions: Actions = {
  addLink: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const res = await apiFetch('/integrations', {
      method: 'POST',
      token: locals.accessToken,
      body: {
        platform: String(form.get('platform') ?? ''),
        url: String(form.get('url') ?? '').trim(),
      },
    });
    if (!res.ok) return fail(res.status, { linkError: res.error?.message ?? 'Could not add that link.' });
    return { linkAdded: true };
  },

  verifyLink: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const res = await apiFetch<Integration>(`/integrations/${id}/verify`, {
      method: 'POST',
      token: locals.accessToken,
    });
    if (!res.ok) return fail(res.status, { linkError: res.error?.message ?? 'Could not verify.' });
    // Tell the page whether the rel="me" check actually found the back-link, so
    // it can nudge the user to add it rather than silently reporting nothing.
    return res.data?.verified ? { linkVerified: true } : { linkUnverified: true };
  },

  toggleBadge: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const displayed = form.get('displayed') === 'true';
    const res = await apiFetch<Integration>(`/integrations/${id}`, {
      method: 'PATCH',
      token: locals.accessToken,
      body: { displayed },
    });
    if (!res.ok) return fail(res.status, { badgeError: res.error?.message ?? 'Could not update badge.' });
    return { badgeToggled: true };
  },

  removeLink: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    await apiFetch(`/integrations/${id}`, { method: 'DELETE', token: locals.accessToken });
    return { linkRemoved: true };
  },

  connectOAuth: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const provider = String(form.get('provider') ?? '');
    const res = await apiFetch<OAuthConnectPrepareResponse>(`/auth/${provider}/connect/prepare`, {
      method: 'POST',
      token: locals.accessToken,
      body: { mobile: false },
    });
    if (!res.ok) return fail(res.status, { oauthError: res.error?.message ?? 'Could not start the connection.' });
    // Redirect the browser to the provider authorization page. This is a plain
    // form action (no use:enhance) so the browser follows the external redirect.
    throw redirect(303, res.data.authUrl);
  },

  disconnectOAuth: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const provider = String(form.get('provider') ?? '');
    await apiFetch(`/auth/${provider}/disconnect`, { method: 'DELETE', token: locals.accessToken });
    return { oauthDisconnected: provider };
  },
};
