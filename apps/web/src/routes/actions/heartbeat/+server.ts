// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Thin proxy for POST /users/me/heartbeat. The client can't call the API
 * directly with auth (tokens live in httpOnly cookies), so it posts here and
 * this handler forwards it with the session token.
 *
 * Returns 204 No Content on success, 401 when the session is gone, and ignores
 * API errors silently — a missed heartbeat is not worth surfacing to the user.
 */
import type { RequestHandler } from '@sveltejs/kit';
import { apiFetch } from '$lib/server/api';

export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.accessToken) return new Response(null, { status: 401 });
  await apiFetch('/users/me/heartbeat', { method: 'POST', token: locals.accessToken });
  return new Response(null, { status: 204 });
};
