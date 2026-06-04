import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import { VIEW_REFERRERS, type ViewReferrer } from '@counter/config';
import type { Thread } from '@counter/types';

export const load: PageServerLoad = async ({ params, url, locals, fetch }) => {
  const refParam = url.searchParams.get('ref');
  const ref: ViewReferrer = VIEW_REFERRERS.includes(refParam as ViewReferrer)
    ? (refParam as ViewReferrer)
    : 'direct';

  const [threadRes] = await Promise.all([
    apiFetch<Thread>(`/posts/${params.id}/thread`, { token: locals.accessToken, fetch }),
    // Separately hit the post endpoint so the anonymous view tick is recorded.
    apiFetch(`/posts/${params.id}`, { query: { ref }, token: locals.accessToken, fetch }),
  ]);

  if (!threadRes.ok) throw error(threadRes.status === 404 ? 404 : 500, 'Post not found');
  return { thread: threadRes.data };
};
