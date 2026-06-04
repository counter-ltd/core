// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Form endpoint for engagement: likes, reposts, and follows (and their undos).
 *
 * A single endpoint backs all of them so the no-JavaScript `<form>` buttons
 * scattered across the UI have one place to post to. The `kind` field picks
 * the action; everything ends in a 303 back to where the user was.
 */
import { redirect, type RequestHandler } from '@sveltejs/kit';
import { apiFetch } from '$lib/server/api';

// Same open-redirect guard as compose: only relative paths are trusted, so a
// forged `redirectTo` can't bounce the user off-site. Defaults to the root.
function safeRedirect(target: FormDataEntryValue | null): string {
  const t = typeof target === 'string' ? target : '/';
  return t.startsWith('/') ? t : '/';
}

/**
 * Apply one engagement toggle and return the user to where they were.
 *
 * Each `kind` maps to a POST (do) or DELETE (undo) against the matching API
 * endpoint. An unrecognised `kind` falls through the switch and just redirects,
 * so a stale or malformed button is a no-op rather than an error.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const form = await request.formData();
  const kind = String(form.get('kind') ?? '');
  const back = safeRedirect(form.get('redirectTo'));

  // No anonymous engagement: send logged-out users to log in first.
  if (!locals.accessToken) throw redirect(303, '/login');
  // Pull into a local so TypeScript keeps the non-null narrowing below.
  const token = locals.accessToken;

  const postId = form.get('postId');
  const username = form.get('username');

  switch (kind) {
    case 'like':
      await apiFetch(`/posts/${postId}/like`, { method: 'POST', token });
      break;
    case 'unlike':
      await apiFetch(`/posts/${postId}/like`, { method: 'DELETE', token });
      break;
    case 'repost':
      await apiFetch(`/posts/${postId}/repost`, { method: 'POST', token });
      break;
    case 'unrepost':
      await apiFetch(`/posts/${postId}/repost`, { method: 'DELETE', token });
      break;
    case 'follow':
      await apiFetch(`/users/${username}/follow`, { method: 'POST', token });
      break;
    case 'unfollow':
      await apiFetch(`/users/${username}/follow`, { method: 'DELETE', token });
      break;
  }

  throw redirect(303, back);
};
