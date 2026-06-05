// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The account settings page: profile editing, notifications, integrations,
 * privacy (device list), and account management.
 *
 * Destructive actions (deleteDevice, deleteAccount) are intentionally separate
 * from routine saves so a stray POST can't wipe anything important.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import { removeAccount } from '$lib/server/session';
import { NOTIFICATION_TYPES, PRESENCE } from '@counter/config';
import type { PrivateUser, Integration, NotificationPreferences, DeviceRecord, PresenceSettings } from '@counter/types';

// Default every type on, so a failed fetch still renders a sensible panel rather
// than blanking the toggles. Mirrors the API's default-on behaviour.
const allOn = (): NotificationPreferences =>
  Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, true])) as NotificationPreferences;

// Safe default when the presence fetch fails: everything off, no data leaked.
const defaultPresence = (): PresenceSettings => ({
  onlineStatusEnabled: false,
  onlineStatusVisibility: PRESENCE.DEFAULT_VISIBILITY,
  lastSeenEnabled: false,
  lastSeenVisibility: PRESENCE.DEFAULT_VISIBILITY,
  heartbeatIntervalSeconds: PRESENCE.DEFAULT_HEARTBEAT_INTERVAL,
});

export const load: PageServerLoad = async ({ locals, fetch }) => {
  if (!locals.user) throw redirect(303, '/login');
  // Profile form is pre-filled from the session user. Everything else needs a
  // fetch; all run in parallel and fall back to safe defaults on failure.
  const [links, prefs, devicesRes, presenceRes] = await Promise.all([
    apiFetch<Integration[]>('/integrations/me', { token: locals.accessToken, fetch }),
    apiFetch<NotificationPreferences>('/notifications/preferences', {
      token: locals.accessToken,
      fetch,
    }),
    apiFetch<DeviceRecord[]>('/devices', { token: locals.accessToken, fetch }),
    apiFetch<PresenceSettings>('/users/me/presence', { token: locals.accessToken, fetch }),
  ]);
  return {
    profile: locals.user,
    links: links.ok ? links.data : [],
    notificationPrefs: prefs.ok ? prefs.data : allOn(),
    devices: devicesRes.ok ? devicesRes.data : [],
    presenceSettings: presenceRes.ok ? presenceRes.data : defaultPresence(),
  };
};

export const actions: Actions = {
  profile: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();

    // Empty fields are sent as null, not "", so clearing a field actually
    // unsets it server-side rather than storing a blank string.
    const body = {
      displayName: String(form.get('displayName') ?? '').trim() || null,
      bio: String(form.get('bio') ?? '').trim() || null,
      avatarUrl: String(form.get('avatarUrl') ?? '').trim() || null,
    };

    const res = await apiFetch<PrivateUser>('/users/me', {
      method: 'PATCH',
      token: locals.accessToken,
      body,
    });
    if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Could not save.' });
    // `saved: true` is the flag the page uses to flash a confirmation.
    return { saved: true };
  },

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

  presence: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();

    const body = {
      onlineStatusEnabled: form.get('onlineStatusEnabled') === 'on',
      onlineStatusVisibility: String(form.get('onlineStatusVisibility') ?? 'everyone'),
      lastSeenEnabled: form.get('lastSeenEnabled') === 'on',
      lastSeenVisibility: String(form.get('lastSeenVisibility') ?? 'everyone'),
      // The range input sends a string; coerce to number for the API.
      heartbeatIntervalSeconds: Number(form.get('heartbeatIntervalSeconds') ?? 300),
    };

    const res = await apiFetch('/users/me/presence', {
      method: 'PUT',
      token: locals.accessToken,
      body,
    });
    if (!res.ok) return fail(res.status, { presenceError: res.error?.message ?? 'Could not save.' });
    return { presenceSaved: true };
  },

  resendVerification: async ({ locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    // A 429 here is the once-an-hour rate limit; surface its message so the user
    // knows to wait rather than re-clicking. Any other failure shows generically.
    const res = await apiFetch('/auth/verify/request', { method: 'POST', token: locals.accessToken });
    if (!res.ok) return fail(res.status, { resendError: res.error?.message ?? 'Could not send right now.' });
    return { resent: true };
  },

  addLink: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const res = await apiFetch('/integrations', {
      method: 'POST',
      token: locals.accessToken,
      body: {
        platform: String(form.get('platform') ?? ''),
        url: String(form.get('url') ?? '').trim(),
      },
    });
    if (!res.ok) return fail(res.status, { linkError: res.error?.message ?? 'Could not add that link.' });
    return { linkAdded: true };
  },

  verifyLink: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const res = await apiFetch<Integration>(`/integrations/${id}/verify`, {
      method: 'POST',
      token: locals.accessToken,
    });
    if (!res.ok) return fail(res.status, { linkError: res.error?.message ?? 'Could not verify.' });
    // Tell the page whether the rel="me" check actually found the back-link, so
    // it can nudge the user to add it rather than silently reporting nothing.
    return res.data?.verified ? { linkVerified: true } : { linkUnverified: true };
  },

  removeLink: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    await apiFetch(`/integrations/${id}`, { method: 'DELETE', token: locals.accessToken });
    return { linkRemoved: true };
  },

  deleteDevice: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    await apiFetch(`/devices/by-id/${id}`, { method: 'DELETE', token: locals.accessToken });
    return { deviceRemoved: true };
  },

  deleteAccount: async ({ request, locals, cookies }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    // Make the user type DELETE so a stray click can't wipe their account.
    if (String(form.get('confirm') ?? '') !== 'DELETE') {
      return fail(400, { error: 'Type DELETE to confirm account deletion.' });
    }
    await apiFetch('/auth/account', { method: 'DELETE', token: locals.accessToken });
    // Remove this account from the list; if another account is stored it
    // becomes active. We still land on /login?deleted for the written
    // confirmation the license (Condition 6) requires.
    removeAccount(cookies, locals.user!.id);
    throw redirect(303, '/login?deleted=1');
  },
};
