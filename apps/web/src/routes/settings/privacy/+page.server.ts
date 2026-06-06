// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Privacy section: presence (online status, last seen, heartbeat, typing),
 * who can message you, and the list of registered push devices.
 *
 * deleteDevice is intentionally a separate action from the routine saves so a
 * stray POST can't drop a device.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import { PRESENCE } from '@counter/config';
import type { DeviceRecord, PresenceSettings } from '@counter/types';

// Safe default when the presence fetch fails: everything off, no data leaked.
const defaultPresence = (): PresenceSettings => ({
  onlineStatusEnabled: false,
  onlineStatusVisibility: PRESENCE.DEFAULT_VISIBILITY,
  lastSeenEnabled: false,
  lastSeenVisibility: PRESENCE.DEFAULT_VISIBILITY,
  // Off on a failed fetch so we never imply typing is broadcast when we can't
  // confirm the real setting; the API default is on.
  typingIndicatorsEnabled: false,
  heartbeatIntervalSeconds: PRESENCE.DEFAULT_HEARTBEAT_INTERVAL,
  messagingPrivacy: 'everyone',
});

export const load: PageServerLoad = async ({ locals, fetch }) => {
  if (!locals.user) throw redirect(303, '/login');
  const [presenceRes, devicesRes] = await Promise.all([
    apiFetch<PresenceSettings>('/users/me/presence', { token: locals.accessToken, fetch }),
    apiFetch<DeviceRecord[]>('/devices', { token: locals.accessToken, fetch }),
  ]);
  return {
    presenceSettings: presenceRes.ok ? presenceRes.data : defaultPresence(),
    devices: devicesRes.ok ? devicesRes.data : [],
  };
};

export const actions: Actions = {
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
      // Unchecked checkboxes send nothing, so absence reads as off.
      typingIndicatorsEnabled: form.get('typingIndicatorsEnabled') === 'on',
    };

    const res = await apiFetch('/users/me/presence', {
      method: 'PUT',
      token: locals.accessToken,
      body,
    });
    if (!res.ok) return fail(res.status, { presenceError: res.error?.message ?? 'Could not save.' });
    return { presenceSaved: true };
  },

  messaging: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const res = await apiFetch('/users/me/presence', {
      method: 'PUT',
      token: locals.accessToken,
      body: { messagingPrivacy: String(form.get('messagingPrivacy') ?? 'everyone') },
    });
    if (!res.ok) return fail(res.status, { messagingError: res.error?.message ?? 'Could not save.' });
    return { messagingSaved: true };
  },

  deleteDevice: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    await apiFetch(`/devices/by-id/${id}`, { method: 'DELETE', token: locals.accessToken });
    return { deviceRemoved: true };
  },
};
