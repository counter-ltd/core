// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Root layout load, run for every page.
 *
 * Its one job is to surface the signed-in user (resolved upstream in hooks and
 * stashed on `locals`) so every layout and page can read it without each one
 * having to re-fetch the session.
 */
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
  // `locals.user` is null for logged-out visitors, which is exactly what the
  // UI keys off to decide between signed-in and signed-out chrome.
  return { user: locals.user };
};
