// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Form endpoint for switching the active account.
 *
 * Reorders the accounts cookie so the chosen account is first, then clears
 * the access token. The hooks middleware exchanges the new active account's
 * refresh token for a fresh access token on the very next request, so the
 * user lands fully signed in as the other account with no extra round trips
 * visible to them.
 */
import { redirect, type RequestHandler } from '@sveltejs/kit';
import { switchToAccount } from '$lib/server/session';

export const POST: RequestHandler = async ({ request, cookies }) => {
  const form = await request.formData();
  const userId = String(form.get('userId') ?? '').trim();

  if (userId) switchToAccount(cookies, userId);

  // Send to the feed; the hooks middleware will log them in as the new active
  // account before the feed's load function even runs.
  throw redirect(303, '/feed');
};
