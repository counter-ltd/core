// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Passkey login handoff. The WebAuthn assertion is produced in the browser (only
 * it can touch the authenticator), but the session tokens must land in httpOnly
 * cookies the browser can't read. So the browser POSTs the signed assertion here
 * and this server endpoint exchanges it for a session, mirroring what the OAuth
 * callback does. The access token never reaches client JavaScript.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiFetch } from '$lib/server/api';
import { setActiveAccount } from '$lib/server/session';
import type { AuthResponse } from '@counter/types';

export const POST: RequestHandler = async ({ request, cookies, fetch }) => {
  // The body is the AuthenticationResponseJSON from @simplewebauthn/browser.
  const response = await request.json().catch(() => null);
  if (!response) return json({ error: 'Invalid passkey response.' }, { status: 400 });

  const res = await apiFetch<AuthResponse>('/auth/passkeys/authenticate/verify', {
    method: 'POST',
    body: { response },
    fetch,
  });
  if (!res.ok) {
    return json({ error: res.error?.message ?? 'Passkey sign-in failed.' }, { status: res.status });
  }

  setActiveAccount(cookies, res.data, res.data.user);
  // The browser navigates to /feed once it sees ok; the Set-Cookie on this
  // response carries the session.
  return json({ ok: true });
};
