// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Root layout load, run for every page.
 *
 * Surfaces the signed-in user and the full account list (minus refresh tokens)
 * so the Nav can render the account switcher without each page needing to fetch
 * either separately. Also seeds the nav unread badges and hands the client the
 * access token it needs to open the live notification socket.
 */
import type { LayoutServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { BadgeCounts } from '@counter/types';

export const load: LayoutServerLoad = async ({ locals, fetch }) => {
  // Seed the nav badges from the server count so they're right on first paint;
  // the live socket keeps them current after that. Zeroed when signed out or the
  // count fetch fails, which just shows no badge rather than erroring.
  let badges: BadgeCounts = { notifications: 0, messages: 0 };
  if (locals.accessToken) {
    const res = await apiFetch<BadgeCounts>('/notifications/badges', {
      token: locals.accessToken,
      fetch,
    });
    if (res.ok) badges = res.data;
  }

  return {
    user: locals.user,
    accounts: locals.accounts,
    badges,
    // The client opens the notification WebSocket directly, which can't carry an
    // Authorization header, so it needs the token here.
    accessToken: locals.accessToken ?? null,
  };
};
