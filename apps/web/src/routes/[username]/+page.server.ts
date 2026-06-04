import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { Page, Post, PublicUser } from '@counter/types';

export const load: PageServerLoad = async ({ params, url, locals, fetch }) => {
  const after = url.searchParams.get('after') ?? undefined;

  const [profileRes, postsRes] = await Promise.all([
    apiFetch<PublicUser>(`/users/${params.username}`, { token: locals.accessToken, fetch }),
    apiFetch<Page<Post>>(`/users/${params.username}/posts`, {
      query: { after, limit: 20 },
      token: locals.accessToken,
      fetch,
    }),
  ]);

  if (!profileRes.ok) throw error(profileRes.status === 404 ? 404 : 500, 'User not found');

  return {
    profile: profileRes.data,
    posts: postsRes.ok ? postsRes.data : { data: [], nextCursor: null },
  };
};
