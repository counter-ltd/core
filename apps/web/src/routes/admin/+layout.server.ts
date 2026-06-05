// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The gate every /admin page sits behind. A signed-out visitor is bounced to
 * login; a signed-in account with no admin permissions gets a 403 rather than a
 * blank panel. The caller's permission list is passed down so each page (and the
 * sub-nav) can show only what that person can actually do.
 */
import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  // Any permission at all is enough to see the panel; individual pages and
  // actions enforce their own specific capability on top.
  if (locals.user.permissions.length === 0) {
    throw error(403, 'You do not have access to the admin panel.');
  }
  return { permissions: locals.user.permissions };
};
