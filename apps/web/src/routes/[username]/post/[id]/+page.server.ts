// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * A single post and its thread (the post plus its replies and ancestors).
 *
 * Loading the page also counts as a view, tagged with where the reader came
 * from so the insights/algorithm side can see how a post is being reached.
 */
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import { VIEW_REFERRERS, type ViewReferrer } from '@counter/config';
import type { Thread } from '@counter/types';

export const load: PageServerLoad = async ({ params, url, locals, fetch }) => {
  // The referrer is attacker-controllable (it's just a query param), so only
  // trust it if it's one we know about; anything else counts as 'direct'.
  const refParam = url.searchParams.get('ref');
  const ref: ViewReferrer = VIEW_REFERRERS.includes(refParam as ViewReferrer)
    ? (refParam as ViewReferrer)
    : 'direct';

  const [threadRes] = await Promise.all([
    apiFetch<Thread>(`/posts/${params.id}/thread`, { token: locals.accessToken, fetch }),
    // Fire-and-forget second call: hitting the post endpoint is what records
    // the view tick (with its referrer). We don't read the result, we just
    // want the side effect to happen in parallel with the thread fetch.
    apiFetch(`/posts/${params.id}`, { query: { ref }, token: locals.accessToken, fetch }),
  ]);

  // Thread is the only result we render, so its failure decides the page:
  // a real 404 for a missing/deleted post, 500 for anything else.
  if (!threadRes.ok) throw error(threadRes.status === 404 ? 404 : 500, 'Post not found');
  return { thread: threadRes.data };
};
