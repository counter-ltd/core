// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Profile section of settings: display name, bio, and avatar. The form is
 * pre-filled straight from the session user, so this load does no fetching of
 * its own.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { PrivateUser } from '@counter/types';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  return { profile: locals.user };
};

export const actions: Actions = {
  profile: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();

    // Empty fields are sent as null, not "", so clearing a field actually
    // unsets it server-side rather than storing a blank string.
    //
    // The avatar is set by object id (uploaded via /actions/upload), and only
    // included when the picker actually changed it: an untouched avatar must not
    // be wiped just because the profile form was saved. `avatarChanged` is the
    // flag the page sets when the user picks a new photo or removes the current
    // one (empty id = remove).
    const avatarChanged = form.get('avatarChanged') === '1';
    const body = {
      displayName: String(form.get('displayName') ?? '').trim() || null,
      bio: String(form.get('bio') ?? '').trim() || null,
      ...(avatarChanged
        ? { avatarObjectId: String(form.get('avatarObjectId') ?? '').trim() || null }
        : {}),
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
};
