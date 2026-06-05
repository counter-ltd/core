// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Lands the reset link from the email and handles setting the new password.
 *
 * The token rides in `?token=` and is carried through the form as a hidden
 * field, so the credential never has to round-trip through anything but the
 * confirm call. The two password fields are matched here before we spend a
 * request. No login is required, the token is the credential, so an expired
 * session doesn't get in the way of a link from an inbox.
 */
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import { USER } from '@counter/config';

export const load: PageServerLoad = ({ url }) => {
  // Surface "no token" up front so the page can say the link is broken rather
  // than rendering a form that's guaranteed to fail on submit.
  return { hasToken: url.searchParams.has('token'), token: url.searchParams.get('token') ?? '' };
};

export const actions: Actions = {
  default: async ({ request, fetch }) => {
    const form = await request.formData();
    const token = String(form.get('token') ?? '');
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm') ?? '');

    if (!token) return fail(400, { error: 'This reset link is missing its token.' });
    if (password.length < USER.MIN_PASSWORD_LENGTH) {
      return fail(400, { error: `Password must be at least ${USER.MIN_PASSWORD_LENGTH} characters.` });
    }
    if (password !== confirm) {
      return fail(400, { error: 'Those passwords don’t match.' });
    }

    const res = await apiFetch('/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, password },
      fetch,
    });

    // The API uses a plain 400 for a stale or already-used token; surface its
    // message so the page can say the link didn't work and point at requesting
    // a fresh one.
    if (!res.ok) {
      return fail(res.status, { error: res.error?.message ?? 'Could not reset your password.' });
    }
    return { done: true };
  },
};
