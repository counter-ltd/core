// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Server-side proxy for media uploads.
 *
 * The browser can't call the API's POST /media directly: the access token lives
 * in an httpOnly cookie the page never sees. So the avatar picker and the post
 * composer upload here instead, and this handler forwards the file to the API
 * with the session's bearer token attached. It streams the multipart body
 * straight through rather than re-encoding, and returns the API's JSON verbatim.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';

function apiUrl(): string {
  return env.PUBLIC_API_URL || 'http://localhost:3000';
}

/**
 * Forward a single uploaded file to the API and relay the result.
 *
 * Returns the API's `{ id, url, ... }` on success, or a `{ error }` body with
 * the upstream status so the client can surface the failure inline.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.accessToken) {
    return json({ error: 'Not signed in' }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return json({ error: 'No file provided' }, { status: 400 });
  }

  // Rebuild the multipart body so we control exactly what reaches the API: just
  // the file under the field name it expects, nothing the browser tacked on.
  const out = new FormData();
  out.append('file', file);

  const res = await fetch(`${apiUrl()}/media`, {
    method: 'POST',
    headers: { authorization: `Bearer ${locals.accessToken}` },
    body: out,
  });

  const data = await res.json().catch(() => ({ error: 'Upload failed' }));
  return json(data, { status: res.status });
};
