// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Root layout load, run for every page.
 *
 * Surfaces the signed-in user and the full account list (minus refresh tokens)
 * so the Nav can render the account switcher without each page needing to
 * fetch either separately.
 */
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
  return { user: locals.user, accounts: locals.accounts };
};
