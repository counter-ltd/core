// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Passkey registration proxy for the settings screen. Registering a passkey is
 * an authenticated API call, but the access token lives in an httpOnly cookie
 * the browser can't read, so the browser can't call the API directly. It calls
 * this endpoint instead (cookie auth), which forwards to the API with the bearer
 * token attached.
 *
 * Two steps share one endpoint, selected by `step`: `options` returns the
 * creation options the browser feeds to the authenticator, and `verify` takes
 * the resulting attestation back. Splitting them keeps the browser-side ceremony
 * (which must run between the two) in the middle.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiFetch } from '$lib/server/api';

export const POST: RequestHandler = async ({ request, locals, fetch }) => {
  if (!locals.accessToken) return json({ error: 'Not signed in.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const step = body?.step;

  if (step === 'options') {
    const res = await apiFetch('/auth/passkeys/register/options', {
      method: 'POST',
      token: locals.accessToken,
      fetch,
    });
    if (!res.ok) return json({ error: res.error?.message ?? 'Could not start.' }, { status: res.status });
    return json(res.data);
  }

  if (step === 'verify') {
    const res = await apiFetch('/auth/passkeys/register/verify', {
      method: 'POST',
      token: locals.accessToken,
      body: { response: body.response, nickname: body.nickname || undefined },
      fetch,
    });
    if (!res.ok) return json({ error: res.error?.message ?? 'Could not save passkey.' }, { status: res.status });
    return json({ ok: true });
  }

  return json({ error: 'Unknown step.' }, { status: 400 });
};
