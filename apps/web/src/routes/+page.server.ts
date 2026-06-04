import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Page, Post } from '@counter/types';

export const load: PageServerLoad = async ({ url, locals, fetch }) => {
  const after = url.searchParams.get('after') ?? undefined;
  const res = await apiFetch<Page<Post>>('/posts/public', {
    query: { after, limit: 20 },
    token: locals.accessToken,
    fetch,
  });
  return {
    feed: res.ok ? res.data : { data: [], nextCursor: null },
  };
};
