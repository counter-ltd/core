// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Form endpoint for per-post moderation: remove a post or restore one a
 * moderator removed.
 *
 * Mirrors the engagement endpoint next door so the no-JavaScript control menu
 * on a post has one place to post to. The `kind` field picks the action and
 * everything ends in a 303 back to where the moderator was. The API does the
 * real permission check (`posts.moderate`); this just forwards the call with
 * the caller's token, so a user without the permission gets a rejection from
 * the API rather than a silent success here.
 */
import { redirect, type RequestHandler } from '@sveltejs/kit';
import { apiFetch } from '$lib/server/api';

// Same open-redirect guard as the engagement endpoint: only relative paths are
// trusted, so a forged `redirectTo` can't bounce the moderator off-site.
function safeRedirect(target: FormDataEntryValue | null): string {
  const t = typeof target === 'string' ? target : '/';
  return t.startsWith('/') ? t : '/';
}

/**
 * Apply one moderation action and return the moderator to where they were.
 *
 * `remove` soft-deletes the post and flags it as an admin removal; `restore`
 * undoes that; `nuke` hard-deletes the post and its whole reply/repost tree with
 * no way back. An unrecognised `kind` falls through and just redirects, so a
 * stale button is a no-op rather than an error.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const form = await request.formData();
  const kind = String(form.get('kind') ?? '');
  const back = safeRedirect(form.get('redirectTo'));

  // Moderation needs auth; the API checks the actual permission.
  if (!locals.accessToken) throw redirect(303, '/login');
  const token = locals.accessToken;

  const postId = form.get('postId');

  switch (kind) {
    case 'remove':
      await apiFetch(`/admin/posts/${postId}`, { method: 'DELETE', token });
      break;
    case 'restore':
      await apiFetch(`/admin/posts/${postId}/restore`, { method: 'POST', token });
      break;
    case 'nuke':
      await apiFetch(`/admin/posts/${postId}/nuke`, { method: 'DELETE', token });
      break;
  }

  throw redirect(303, back);
};
