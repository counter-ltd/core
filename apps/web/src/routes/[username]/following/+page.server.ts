import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Page, PublicUser } from '@counter/types';

export const load: PageServerLoad = async ({ params, url, locals, fetch }) => {
  const after = url.searchParams.get('after') ?? undefined;
  const res = await apiFetch<Page<PublicUser>>(`/users/${params.username}/following`, {
    query: { after, limit: 30 },
    token: locals.accessToken,
    fetch,
  });
  if (!res.ok) throw error(res.status === 404 ? 404 : 500, 'Not found');
  return { username: params.username, kind: 'following' as const, list: res.data };
};
