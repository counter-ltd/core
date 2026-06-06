// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * /settings has no page of its own now that each section is a child route.
 * Land visitors on Profile, the first section. The auth check lives in each
 * section's server load, so an unauthenticated hit still ends up at /login.
 */
import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
  throw redirect(307, '/settings/profile');
};
