// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The "forgot your password" page: takes an email and asks the API to mail a
 * reset link.
 *
 * The API answers the same way whether or not the address matches an account, so
 * there's no enumeration to leak here either. We mirror that: on any non-error
 * response the page shows the same "if that address exists, check your inbox"
 * confirmation, never confirming the email was real.
 */
import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { apiFetch } from '$lib/server/api';

export const actions: Actions = {
  default: async ({ request, fetch }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim();

    // Cheap presence check before spending a round trip. Echo the address back
    // so the field survives the reload.
    if (!email) {
      return fail(400, { email, error: 'Enter the email on your account.' });
    }

    const res = await apiFetch('/auth/password-reset/request', {
      method: 'POST',
      body: { email },
      fetch,
    });

    // A validation error (a malformed address) is worth surfacing; anything else
    // resolves to the same uniform "sent" state, since the API won't tell us
    // whether the address mapped to an account and neither should we.
    if (!res.ok && res.status === 400) {
      return fail(400, { email, error: 'That doesn’t look like a valid email address.' });
    }
    return { sent: true };
  },
};
