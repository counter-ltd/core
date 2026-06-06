// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Notifications section: per-type notification preferences plus browser Web
 * Push. The subscribe/unsubscribe actions are proxied through the server so
 * the access token never touches client JavaScript.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import { NOTIFICATION_TYPES } from '@counter/config';
import type { NotificationPreferences } from '@counter/types';

// Default every type on, so a failed fetch still renders a sensible panel rather
// than blanking the toggles. Mirrors the API's default-on behaviour.
const allOn = (): NotificationPreferences =>
  Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, true])) as NotificationPreferences;

export const load: PageServerLoad = async ({ locals, fetch }) => {
  if (!locals.user) throw redirect(303, '/login');
  const [prefs, vapidRes] = await Promise.all([
    apiFetch<NotificationPreferences>('/notifications/preferences', {
      token: locals.accessToken,
      fetch,
    }),
    // The VAPID public key the browser needs to subscribe to Web Push. Null
    // when web push isn't configured, which hides the toggle.
    apiFetch<{ key: string | null }>('/web-push/vapid-public-key', {
      token: locals.accessToken,
      fetch,
    }),
  ]);
  return {
    notificationPrefs: prefs.ok ? prefs.data : allOn(),
    vapidPublicKey: vapidRes.ok ? vapidRes.data.key : null,
  };
};

export const actions: Actions = {
  notifications: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();

    // The checkboxes only POST when checked, so an absent key means "off". We
    // send an explicit boolean for every type rather than only the present ones,
    // which keeps the save idempotent regardless of what the browser omits.
    const body = Object.fromEntries(
      NOTIFICATION_TYPES.map((t) => [t, form.get(t) === 'on']),
    ) as NotificationPreferences;

    const res = await apiFetch('/notifications/preferences', {
      method: 'PUT',
      token: locals.accessToken,
      body,
    });
    if (!res.ok) return fail(res.status, { notifyError: res.error?.message ?? 'Could not save.' });
    return { notifySaved: true };
  },

  // Browser push subscribe/unsubscribe are proxied through the server so the
  // access token stays out of client JavaScript. The browser does the actual
  // PushManager work, then posts the resulting subscription JSON here.
  subscribePush: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const raw = String(form.get('subscription') ?? '');
    let subscription: unknown;
    try {
      subscription = JSON.parse(raw);
    } catch {
      return fail(400, { pushError: 'Invalid subscription.' });
    }
    const res = await apiFetch('/web-push/subscribe', {
      method: 'POST',
      token: locals.accessToken,
      body: subscription,
    });
    if (!res.ok) return fail(res.status, { pushError: res.error?.message ?? 'Could not enable notifications.' });
    return { pushEnabled: true };
  },

  unsubscribePush: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const endpoint = String(form.get('endpoint') ?? '');
    if (!endpoint) return fail(400, { pushError: 'Missing endpoint.' });
    const res = await apiFetch('/web-push/subscribe', {
      method: 'DELETE',
      token: locals.accessToken,
      body: { endpoint },
    });
    if (!res.ok) return fail(res.status, { pushError: res.error?.message ?? 'Could not disable notifications.' });
    return { pushDisabled: true };
  },
};
