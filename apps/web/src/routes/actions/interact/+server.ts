import { redirect, type RequestHandler } from '@sveltejs/kit';
import { apiFetch } from '$lib/server/api';

/** Safe internal redirect target only (no open redirects). */
function safeRedirect(target: FormDataEntryValue | null): string {
  const t = typeof target === 'string' ? target : '/';
  return t.startsWith('/') ? t : '/';
}

/**
 * One endpoint for all engagement toggles, posted from plain <form>s so likes,
 * reposts, and follows work with JavaScript disabled. Each maps to an API call
 * and 303-redirects back to where the user was.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const form = await request.formData();
  const kind = String(form.get('kind') ?? '');
  const back = safeRedirect(form.get('redirectTo'));

  if (!locals.accessToken) throw redirect(303, '/login');
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
