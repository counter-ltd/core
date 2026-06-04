// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The insights dashboard: stats about the viewer's own profile, the platform
 * as a whole, and optionally one specific post.
 *
 * The per-post panel is opt-in via `?post=<id>`; without it we just load the
 * profile and platform numbers.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { ProfileInsights, PostInsights, PublicInsights } from '@counter/types';

export const load: PageServerLoad = async ({ url, locals, fetch }) => {
  // Profile insights are private to the signed-in user, so gate the page.
  if (!locals.user) throw redirect(303, '/login');

  const postId = url.searchParams.get('post') ?? undefined;

  const [profileRes, publicRes, postRes] = await Promise.all([
    apiFetch<ProfileInsights>('/insights/profile', { token: locals.accessToken, fetch }),
    // Platform numbers are public, so this call goes out without a token.
    apiFetch<PublicInsights>('/insights/public', { fetch }),
    // Only fetch post insights when a post was named. Resolving to null keeps
    // this slot in the Promise.all tuple so the destructuring stays aligned.
    postId
      ? apiFetch<PostInsights>(`/insights/posts/${postId}`, { token: locals.accessToken, fetch })
      : Promise.resolve(null),
  ]);

  // Each panel degrades to null on its own, so one failed section doesn't blank
  // the others. `postRes &&` also covers the "no post requested" null case.
  return {
    profile: profileRes.ok ? profileRes.data : null,
    platform: publicRes.ok ? publicRes.data : null,
    post: postRes && postRes.ok ? postRes.data : null,
  };
};
