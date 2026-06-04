// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Form endpoint for logging out.
 *
 * Logout has two halves: tell the API to revoke the session, then clear the
 * cookies on this side. We do both so a stolen refresh token can't outlive the
 * logout, and the browser is left genuinely signed out.
 */
import { redirect, type RequestHandler } from '@sveltejs/kit';
import { apiFetch } from '$lib/server/api';
import { readTokens, clearSessionCookies } from '$lib/server/session';

export const POST: RequestHandler = async ({ cookies }) => {
  const { refreshToken } = readTokens(cookies);
  // Only call the API when we actually hold a refresh token. Server-side
  // revocation is keyed on it, and there's nothing to revoke without one.
  if (refreshToken) {
    await apiFetch('/auth/logout', { method: 'POST', body: { refreshToken } });
  }
  // Clear cookies regardless of how the API call went, so the user is logged
  // out locally even if revocation failed.
  clearSessionCookies(cookies);
  throw redirect(303, '/');
};
