// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The login page: shows the form and handles its submission.
 *
 * On success it stores the session in cookies and sends the user to their feed.
 * Failures come back as `fail()` so the form can re-render with the error and
 * keep what the user typed.
 *
 * We don't redirect already-signed-in visitors: they may be here to add a
 * second account. The `?add=1` param is what the Nav links to in that case,
 * but the form works even if someone lands here directly while signed in.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import { setActiveAccount } from '$lib/server/session';
import type { AuthResponse } from '@counter/types';

export const load: PageServerLoad = ({ locals, url }) => {
  // Only redirect when the visitor is already signed in and isn't deliberately
  // adding another account. This keeps "go to /login" as a shortcut to the
  // feed for users who have a session, while still letting them arrive here
  // explicitly to sign in as someone else.
  if (locals.user && !url.searchParams.has('add')) throw redirect(303, '/feed');
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    // `identifier` is either a username or an email; the API accepts both.
    const identifier = String(form.get('identifier') ?? '').trim();
    const password = String(form.get('password') ?? '');

    // Cheap presence check before spending a round trip on the API. We echo the
    // identifier back (but never the password) so the field survives the reload.
    if (!identifier || !password) {
      return fail(400, { identifier, error: 'Enter your username/email and password.' });
    }

    const res = await apiFetch<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { identifier, password },
    });

    // Surface the API's own message when it gives one (wrong password, locked
    // account), with a generic fallback so we never show a blank error.
    if (!res.ok) {
      return fail(res.status, { identifier, error: res.error?.message ?? 'Login failed.' });
    }

    // Add the account to the list (or move it to the front if already there)
    // and set the new access cookie. On first login this is identical to the
    // old single-account behaviour.
    setActiveAccount(cookies, res.data, res.data.user);
    throw redirect(303, '/feed');
  },
};
