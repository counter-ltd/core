import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { ProfileInsights, PostInsights, PublicInsights } from '@counter/types';

export const load: PageServerLoad = async ({ url, locals, fetch }) => {
  if (!locals.user) throw redirect(303, '/login');

  const postId = url.searchParams.get('post') ?? undefined;

  const [profileRes, publicRes, postRes] = await Promise.all([
    apiFetch<ProfileInsights>('/insights/profile', { token: locals.accessToken, fetch }),
    apiFetch<PublicInsights>('/insights/public', { fetch }),
    postId
      ? apiFetch<PostInsights>(`/insights/posts/${postId}`, { token: locals.accessToken, fetch })
      : Promise.resolve(null),
  ]);

  return {
    profile: profileRes.ok ? profileRes.data : null,
    platform: publicRes.ok ? publicRes.data : null,
    post: postRes && postRes.ok ? postRes.data : null,
  };
};
