// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Form endpoint for composing: creates a top-level post or a reply.
 *
 * Posted from a plain `<form>` so writing works with JavaScript disabled, and
 * always answers with a 303 redirect (the post/redirect/get pattern) so a
 * refresh can't resubmit the same post.
 */
import { redirect, type RequestHandler } from '@sveltejs/kit';
import { apiFetch } from '$lib/server/api';
import type { Post } from '@counter/types';

// Only honour redirect targets that point back into this app. A target that
// isn't a relative path could send the user to an attacker's site, so anything
// not starting with '/' falls back to the feed.
function safeRedirect(target: FormDataEntryValue | null): string {
  const t = typeof target === 'string' ? target : '/feed';
  return t.startsWith('/') ? t : '/feed';
}

/**
 * Handle a compose submission.
 *
 * The presence of `parentId` is what splits the two paths: with it we post a
 * reply under that post, without it we create a new top-level post (optionally
 * filed under a topic).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const form = await request.formData();
  const body = String(form.get('body') ?? '').trim();
  const parentId = form.get('parentId');
  const topicId = form.get('topicId');
  const back = safeRedirect(form.get('redirectTo'));

  // Can't post while logged out; bounce to login before touching the API.
  if (!locals.accessToken) throw redirect(303, '/login');
  // Empty after trimming means nothing to say: quietly send them back.
  if (!body) throw redirect(303, back);

  if (parentId) {
    await apiFetch(`/posts/${parentId}/replies`, {
      method: 'POST',
      token: locals.accessToken,
      body: { body },
    });
    throw redirect(303, back);
  }

  const res = await apiFetch<Post>('/posts', {
    method: 'POST',
    token: locals.accessToken,
    body: { body, ...(topicId ? { topicId: String(topicId) } : {}) },
  });

  // On success, drop the author straight onto their new post's page. If the
  // create somehow failed, fall back to wherever they came from.
  if (res.ok && res.data?.id) {
    throw redirect(303, `/${res.data.author.username}/post/${res.data.id}`);
  }
  throw redirect(303, back);
};
