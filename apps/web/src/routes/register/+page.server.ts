// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The sign-up page: shows the form and handles account creation.
 *
 * Mirrors login. On success it logs the new user straight in (sets session
 * cookies) and drops them on the feed, no separate login step.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import { setSessionCookies } from '$lib/server/session';
import type { AuthResponse } from '@counter/types';

export const load: PageServerLoad = ({ locals }) => {
  // An already-signed-in user has no business on the register page.
  if (locals.user) throw redirect(303, '/feed');
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

    // Register returns a full session, so seat the cookies and go, treating the
    // new account as logged in immediately.
    setSessionCookies(cookies, res.data);
    throw redirect(303, '/feed');
  },
};
