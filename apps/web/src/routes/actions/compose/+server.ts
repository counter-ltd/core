import { redirect, type RequestHandler } from '@sveltejs/kit';
import { apiFetch } from '$lib/server/api';
import type { Post } from '@counter/types';

function safeRedirect(target: FormDataEntryValue | null): string {
  const t = typeof target === 'string' ? target : '/feed';
  return t.startsWith('/') ? t : '/feed';
}

/** Create a post or a reply from a plain form. Works without JavaScript. */
export const POST: RequestHandler = async ({ request, locals }) => {
  const form = await request.formData();
  const body = String(form.get('body') ?? '').trim();
  const parentId = form.get('parentId');
  const back = safeRedirect(form.get('redirectTo'));

  if (!locals.accessToken) throw redirect(303, '/login');
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
    body: { body },
  });

  // Land on the new post when we can; otherwise return to the feed.
  if (res.ok && res.data?.id) {
    throw redirect(303, `/${res.data.author.username}/post/${res.data.id}`);
  }
  throw redirect(303, back);
};
