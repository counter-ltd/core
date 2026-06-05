// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Shared, reactive unread counts for the nav badges.
 *
 * A `.svelte.ts` module so the `$state` is reactive across components: the root
 * layout seeds and increments it (from the server count and the live socket),
 * and the Nav reads it. Seeded from `GET /notifications/badges` on each page
 * load, so it self-corrects to the truth on navigation; between navigations the
 * live socket nudges it.
 */
export const badges = $state<{ notifications: number; messages: number }>({
  notifications: 0,
  messages: 0,
});
