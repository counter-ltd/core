// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Account section: email verification, password, passkeys, and account
 * deletion. The add-passkey ceremony runs through the /settings/passkeys
 * endpoint (it needs the browser-side WebAuthn step); rename and remove are
 * plain form posts here.
 *
 * deleteAccount is intentionally separate from the routine saves and guarded by
 * a typed confirmation so a stray POST can't wipe an account.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import { removeAccount } from '$lib/server/session';
import type { PasskeySummary } from '@counter/types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
  if (!locals.user) throw redirect(303, '/login');
  const passkeysRes = await apiFetch<PasskeySummary[]>('/auth/passkeys', {
    token: locals.accessToken,
    fetch,
  });
  return {
    profile: locals.user,
    passkeys: passkeysRes.ok ? passkeysRes.data : [],
  };
};

export const actions: Actions = {
  // Set or change the account password. The current-password field is only sent
  // (and only required) when the account already has one; an OAuth-only account
  // setting its first password leaves it empty. The API decides which rule
  // applies, so we just forward whatever the form gives us.
  setPassword: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const currentPassword = String(form.get('currentPassword') ?? '');
    const body: Record<string, unknown> = {
      newPassword: String(form.get('newPassword') ?? ''),
    };
    if (currentPassword) body.currentPassword = currentPassword;
    const res = await apiFetch('/auth/password', {
      method: 'POST',
      token: locals.accessToken,
      body,
    });
    if (!res.ok) return fail(res.status, { passwordError: res.error?.message ?? 'Could not save.' });
    return { passwordSaved: true };
  },

  // Relabel a passkey. The add flow runs through the /settings/passkeys endpoint
  // (it needs the browser-side ceremony in the middle); rename and remove are
  // plain form posts, like deleteDevice.
  renamePasskey: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const nickname = String(form.get('nickname') ?? '').trim();
    const res = await apiFetch(`/auth/passkeys/${id}`, {
      method: 'PATCH',
      token: locals.accessToken,
      body: { nickname },
    });
    if (!res.ok) return fail(res.status, { passkeyError: res.error?.message ?? 'Could not rename.' });
    return { passkeyRenamed: true };
  },

  removePasskey: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    await apiFetch(`/auth/passkeys/${id}`, { method: 'DELETE', token: locals.accessToken });
    return { passkeyRemoved: true };
  },

  resendVerification: async ({ locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    // A 429 here is the once-an-hour rate limit; surface its message so the user
    // knows to wait rather than re-clicking. Any other failure shows generically.
    const res = await apiFetch('/auth/verify/request', { method: 'POST', token: locals.accessToken });
    if (!res.ok) return fail(res.status, { resendError: res.error?.message ?? 'Could not send right now.' });
    return { resent: true };
  },

  deleteAccount: async ({ request, locals, cookies }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    // Make the user type DELETE so a stray click can't wipe their account.
    if (String(form.get('confirm') ?? '') !== 'DELETE') {
      return fail(400, { error: 'Type DELETE to confirm account deletion.' });
    }
    await apiFetch('/auth/account', { method: 'DELETE', token: locals.accessToken });
    // Remove this account from the list; if another account is stored it
    // becomes active. We still land on /login?deleted for the written
    // confirmation the license (Condition 6) requires.
    removeAccount(cookies, locals.user!.id);
    throw redirect(303, '/login?deleted=1');
  },
};
