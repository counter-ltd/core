// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Form endpoint for logging out of the current account.
 *
 * Logout has two halves: tell the API to revoke the session, then remove this
 * account from the local cookie list. If another account is still stored, the
 * hooks middleware will pick it up and sign the user in as that account on the
 * next request. If this was the last account, the user lands on the home page
 * signed out.
 */
import { redirect, type RequestHandler } from '@sveltejs/kit';
import { apiFetch } from '$lib/server/api';
import { readTokens, getActiveAccount, removeAccount } from '$lib/server/session';

export const POST: RequestHandler = async ({ cookies }) => {
  const active = getActiveAccount(cookies);
  const { refreshToken } = readTokens(cookies);

  // Only call the API when we actually hold a refresh token; server-side
  // revocation is keyed on it, and there's nothing to revoke without one.
  if (active && refreshToken) {
    await apiFetch('/auth/logout', { method: 'POST', body: { refreshToken } });
  }

  // Remove the account regardless of whether the API call succeeded, so the
  // user is always signed out of this account locally.
  const next = active ? removeAccount(cookies, active.userId) : null;

  // Another account in the list? The hooks middleware will refresh it and sign
  // the user in automatically on the next request.
  throw redirect(303, next ? '/feed' : '/');
};
