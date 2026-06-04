// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * A single topic's page: the topic details plus its post feed, with a
 * join/leave action.
 *
 * Unlike the directory's join action, this one figures out the join-vs-leave
 * direction itself by reading the viewer's current membership, since the
 * full-page form doesn't carry that state.
 */
import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Topic, Page, Post } from '@counter/types';

export const load: PageServerLoad = async ({ params, url, locals, fetch }) => {
  const slug = params.slug;
  const after = url.searchParams.get('after') ?? undefined;

  // Topic header and its feed in parallel; independent reads.
  const [topicRes, postsRes] = await Promise.all([
    apiFetch<Topic>(`/topics/${slug}`, { token: locals.accessToken, fetch }),
    apiFetch<Page<Post>>(`/topics/${slug}/posts`, {
      query: { after, limit: 20 },
      token: locals.accessToken,
      fetch,
    }),
  ]);

  // No topic, no page. Always 404 here (vs the user routes' 404/500 split),
  // since a failed topic lookup almost always means an unknown slug.
  if (!topicRes.ok) throw error(404, 'Topic not found');

  return {
    topic: topicRes.data,
    // Feed degrades to empty so a failed posts call still shows the header.
    feed: postsRes.ok ? postsRes.data : { data: [], nextCursor: null },
  };
};

export const actions: Actions = {
  join: async ({ params, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const slug = params.slug;

    // Re-read the topic to learn whether the viewer is already a member; that's
    // what decides leave vs join below. A failed read means the topic is gone,
    // so bounce to the directory rather than acting blind.
    const topicRes = await apiFetch<Topic>(`/topics/${slug}`, { token: locals.accessToken });
    if (!topicRes.ok) throw redirect(303, '/topics');

    // Already a member means this click is a leave; default to joining when the
    // viewer state is missing.
    const leaving = topicRes.data.viewer?.isMember ?? false;
    await apiFetch(`/topics/${slug}/join`, {
      method: leaving ? 'DELETE' : 'POST',
      token: locals.accessToken,
    });

    throw redirect(303, `/topics/${slug}`);
  },
};
