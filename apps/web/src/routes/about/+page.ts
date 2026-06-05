// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * /about has no page of its own; it lands on the Algorithm tab, the most
 * "this is how Counter works" of the four. Keeps a bare /about link in the nav
 * pointing somewhere useful instead of a blank index.
 */
import { redirect } from '@sveltejs/kit';

export function load() {
  throw redirect(307, '/about/algorithm');
}
