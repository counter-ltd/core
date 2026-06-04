// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The public "how the algorithm works" page: the current ranking config plus
 * the history of changes to it.
 *
 * Both come from public endpoints (no token passed), so anyone can inspect how
 * the feed is ranked.
 */
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { AlgorithmState, AlgorithmChangelogEntry, Page } from '@counter/types';

export const load: PageServerLoad = async ({ fetch }) => {
  // Fetched together; the two are independent reads of the same subsystem.
  const [stateRes, logRes] = await Promise.all([
    apiFetch<AlgorithmState>('/algorithm', { fetch }),
    apiFetch<Page<AlgorithmChangelogEntry>>('/algorithm/changelog', { fetch }),
  ]);
  return {
    // null lets the page show a "couldn't load" state instead of erroring.
    algorithm: stateRes.ok ? stateRes.data : null,
    // Unwrap the paginated envelope to the bare entry list; the page renders
    // the whole history at once and doesn't page through it.
    changelog: logRes.ok ? logRes.data.data : [],
  };
};
