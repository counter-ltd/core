// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The account settings page: edit your profile, or delete the account.
 *
 * The two actions are very different in weight, so they're kept separate: a
 * routine `profile` save, and a guarded `deleteAccount` that needs explicit
 * typed confirmation and tears the session down afterwards.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import { clearSessionCookies } from '$lib/server/session';
import type { PrivateUser, Integration } from '@counter/types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
  if (!locals.user) throw redirect(303, '/login');
  // The profile form is pre-filled from the session user we already have. The
  // links list needs a fetch; on failure we fall back to an empty list so the
  // rest of settings still renders.
  const links = await apiFetch<Integration[]>('/integrations/me', {
    token: locals.accessToken,
    fetch,
  });
  return { profile: locals.user, links: links.ok ? links.data : [] };
};

export const actions: Actions = {
  profile: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();

    // Empty fields are sent as null, not "", so clearing a field actually
    // unsets it server-side rather than storing a blank string.
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
    // `saved: true` is the flag the page uses to flash a confirmation.
    return { saved: true };
  },

  resendVerification: async ({ locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    // The API always answers ok (it quietly skips if already verified or if mail
    // isn't configured), so there's nothing to branch on; just flash "sent".
    await apiFetch('/auth/verify/request', { method: 'POST', token: locals.accessToken });
    return { resent: true };
  },

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

  removeLink: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    await apiFetch(`/integrations/${id}`, { method: 'DELETE', token: locals.accessToken });
    return { linkRemoved: true };
  },

  deleteAccount: async ({ request, locals, cookies }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    // Make the user type DELETE so a stray click can't wipe their account.
    if (String(form.get('confirm') ?? '') !== 'DELETE') {
      return fail(400, { error: 'Type DELETE to confirm account deletion.' });
    }
    await apiFetch('/auth/account', { method: 'DELETE', token: locals.accessToken });
    // The account is gone, so clear the now-dead session cookies before sending
    // them on. We land on /login with ?deleted so the user gets the written
    // confirmation of deletion the license (Condition 6) requires, not a silent
    // bounce to the feed.
    clearSessionCookies(cookies);
    throw redirect(303, '/login?deleted=1');
  },
};
