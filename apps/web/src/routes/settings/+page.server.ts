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
import type {
  PrivateUser,
  Integration,
  NotificationPreferences,
  DeviceRecord,
  PresenceSettings,
  OAuthConnectedAccount,
  OAuthConnectPrepareResponse,
  DiscordBotSettings,
} from '@counter/types';

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
  // Off on a failed fetch so we never imply typing is broadcast when we can't
  // confirm the real setting; the API default is on.
  typingIndicatorsEnabled: false,
  heartbeatIntervalSeconds: PRESENCE.DEFAULT_HEARTBEAT_INTERVAL,
  messagingPrivacy: 'everyone',
});

export const load: PageServerLoad = async ({ locals, fetch }) => {
  if (!locals.user) throw redirect(303, '/login');
  // Profile form is pre-filled from the session user. Everything else needs a
  // fetch; all run in parallel and fall back to safe defaults on failure.
  const [links, prefs, devicesRes, presenceRes, githubRes, discordRes, discordBotRes, vapidRes] =
    await Promise.all([
      apiFetch<Integration[]>('/integrations/me', { token: locals.accessToken, fetch }),
      apiFetch<NotificationPreferences>('/notifications/preferences', {
        token: locals.accessToken,
        fetch,
      }),
      apiFetch<DeviceRecord[]>('/devices', { token: locals.accessToken, fetch }),
      apiFetch<PresenceSettings>('/users/me/presence', { token: locals.accessToken, fetch }),
      // 404 means not connected — treat as null, not an error.
      apiFetch<OAuthConnectedAccount>('/auth/github/me', { token: locals.accessToken, fetch }),
      apiFetch<OAuthConnectedAccount>('/auth/discord/me', { token: locals.accessToken, fetch }),
      apiFetch<DiscordBotSettings>('/discord-bot/settings', { token: locals.accessToken, fetch }),
      // The VAPID public key the browser needs to subscribe to Web Push. Null
      // when web push isn't configured, which hides the toggle.
      apiFetch<{ key: string | null }>('/web-push/vapid-public-key', {
        token: locals.accessToken,
        fetch,
      }),
    ]);
  return {
    profile: locals.user,
    links: links.ok ? links.data : [],
    notificationPrefs: prefs.ok ? prefs.data : allOn(),
    devices: devicesRes.ok ? devicesRes.data : [],
    presenceSettings: presenceRes.ok ? presenceRes.data : defaultPresence(),
    githubAccount: githubRes.ok ? githubRes.data : null,
    discordAccount: discordRes.ok ? discordRes.data : null,
    discordBotSettings: discordBotRes.ok
      ? discordBotRes.data
      : { enabled: false, inGuild: false, guildCheckedAt: null, postingEnabled: false },
    vapidPublicKey: vapidRes.ok ? vapidRes.data.key : null,
  };
};

export const actions: Actions = {
  profile: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();

    // Empty fields are sent as null, not "", so clearing a field actually
    // unsets it server-side rather than storing a blank string.
    //
    // The avatar is set by object id (uploaded via /actions/upload), and only
    // included when the picker actually changed it: an untouched avatar must not
    // be wiped just because the profile form was saved. `avatarChanged` is the
    // flag the page sets when the user picks a new photo or removes the current
    // one (empty id = remove).
    const avatarChanged = form.get('avatarChanged') === '1';
    const body = {
      displayName: String(form.get('displayName') ?? '').trim() || null,
      bio: String(form.get('bio') ?? '').trim() || null,
      ...(avatarChanged
        ? { avatarObjectId: String(form.get('avatarObjectId') ?? '').trim() || null }
        : {}),
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

  toggleBadge: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const displayed = form.get('displayed') === 'true';
    const res = await apiFetch<Integration>(`/integrations/${id}`, {
      method: 'PATCH',
      token: locals.accessToken,
      body: { displayed },
    });
    if (!res.ok) return fail(res.status, { badgeError: res.error?.message ?? 'Could not update badge.' });
    return { badgeToggled: true };
  },

  removeLink: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    await apiFetch(`/integrations/${id}`, { method: 'DELETE', token: locals.accessToken });
    return { linkRemoved: true };
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

  connectOAuth: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const provider = String(form.get('provider') ?? '');
    const res = await apiFetch<OAuthConnectPrepareResponse>(`/auth/${provider}/connect/prepare`, {
      method: 'POST',
      token: locals.accessToken,
      body: { mobile: false },
    });
    if (!res.ok) return fail(res.status, { oauthError: res.error?.message ?? 'Could not start the connection.' });
    // Redirect the browser to the provider authorization page. This is a plain
    // form action (no use:enhance) so the browser follows the external redirect.
    throw redirect(303, res.data.authUrl);
  },

  disconnectOAuth: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const provider = String(form.get('provider') ?? '');
    await apiFetch(`/auth/${provider}/disconnect`, { method: 'DELETE', token: locals.accessToken });
    return { oauthDisconnected: provider };
  },

  deleteDevice: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    await apiFetch(`/devices/by-id/${id}`, { method: 'DELETE', token: locals.accessToken });
    return { deviceRemoved: true };
  },

  discordBot: async ({ request, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const form = await request.formData();
    const enabled = form.get('enabled') === 'true';
    // postingEnabled is only included when the posting toggle is the one being changed.
    const postingEnabledRaw = form.get('postingEnabled');
    const body: Record<string, unknown> = { enabled };
    if (postingEnabledRaw !== null) body.postingEnabled = postingEnabledRaw === 'true';
    const res = await apiFetch<DiscordBotSettings>('/discord-bot/settings', {
      method: 'PUT',
      token: locals.accessToken,
      body,
    });
    if (!res.ok) {
      return fail(res.status, {
        discordBotError: res.error?.message ?? 'Could not update setting.',
        discordBotErrorCode: res.error?.code ?? 'error',
      });
    }
    return { discordBotSaved: true, discordBotSettings: res.data };
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
