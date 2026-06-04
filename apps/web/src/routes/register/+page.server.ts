// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The sign-up page: shows the form and handles account creation.
 *
 * Mirrors login. On success it logs the new user straight in (adds the account
 * to the session list) and drops them on the feed, no separate login step.
 * Like login, it doesn't redirect signed-in visitors so they can create a
 * second account while already signed in.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import { setActiveAccount } from '$lib/server/session';
import type { AuthResponse } from '@counter/types';

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.user && !url.searchParams.has('add')) throw redirect(303, '/feed');
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    // Usernames are lowercased here so they're stored and compared
    // case-insensitively; the API treats them as canonical.
    const username = String(form.get('username') ?? '').trim().toLowerCase();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    // Display name is optional: collapse a blank one to undefined so we omit it
    // from the request rather than sending an empty string.
    const displayName = String(form.get('displayName') ?? '').trim() || undefined;

    // Everything except the password is safe to echo back into the re-rendered
    // form, so the user doesn't have to retype it after a validation error.
    const values = { username, email, displayName: displayName ?? '' };

    if (!username || !email || !password) {
      return fail(400, { ...values, error: 'Username, email and password are required.' });
    }

    const res = await apiFetch<AuthResponse>('/auth/register', {
      method: 'POST',
      body: { username, email, password, displayName },
    });

    // The API owns the real validation (taken username, weak password); pass
    // its message through with a generic fallback.
    if (!res.ok) {
      return fail(res.status, { ...values, error: res.error?.message ?? 'Could not create account.' });
    }

    // Register returns a full session — add the new account to the list and
    // make it active immediately.
    setActiveAccount(cookies, res.data, res.data.user);
    throw redirect(303, '/feed');
  },
};
