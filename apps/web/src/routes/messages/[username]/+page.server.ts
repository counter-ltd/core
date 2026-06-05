// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * A private conversation between the signed-in user and one other person.
 *
 * Loading the page marks all messages from the partner as read as a side
 * effect. The send action creates the conversation on first use (the API
 * handles that transparently).
 *
 * Both sides' device key lists are fetched at load time so the client has
 * the full encryption target set without any additional round trips on send.
 */
import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { DirectMessage, DeviceKey, Page, PublicUser, ConversationInfo, TunnelSession } from '@counter/types';

export const load: PageServerLoad = async ({ params, url, locals, fetch }) => {
  if (!locals.user) throw redirect(303, '/login');

  const { username } = params;
  const after = url.searchParams.get('after') ?? undefined;

  const [messagesRes, partnerKeyRes, myKeyRes, , partnerProfileRes, convInfoRes, pendingTunnelRes] = await Promise.all([
    apiFetch<Page<DirectMessage> & { tunnelSessions?: Record<string, unknown> }>(`/messages/${username}`, {
      query: { after, limit: 40 },
      token: locals.accessToken,
      fetch,
    }),
    // Public; fetched without auth so it always returns the current list.
    apiFetch<{ keys: DeviceKey[] }>(`/users/${username}/public-key`, { fetch }),
    // Own device keys so the client knows which of its devices will get copies.
    locals.accessToken
      ? apiFetch<{ keys: DeviceKey[] }>('/auth/keys', { token: locals.accessToken, fetch })
      : Promise.resolve({ ok: false as const, data: null, status: 401, error: null }),
    // Mark partner's messages as read whenever the thread is opened.
    locals.accessToken
      ? apiFetch(`/messages/${username}/read`, {
          method: 'POST',
          token: locals.accessToken,
          fetch,
        })
      : Promise.resolve(null),
    // Partner profile for presence data; pass the viewer token so visibility
    // rules (followers-only, mutual) are evaluated correctly.
    apiFetch<PublicUser>(`/users/${username}`, {
      token: locals.accessToken,
      fetch,
    }),
    // Request state so the thread can show accept/decline or a pending banner.
    apiFetch<ConversationInfo>(`/messages/${username}/info`, {
      token: locals.accessToken,
      fetch,
    }),
    // Check for an incoming Tunnel Talk invite from this partner.
    locals.accessToken
      ? apiFetch<{ pending: boolean; session: TunnelSession | null }>(`/tunnel/${username}/pending`, {
          token: locals.accessToken,
          fetch,
        })
      : Promise.resolve({ ok: false as const, data: null, status: 401, error: null }),
  ]);

  const messagesData = messagesRes.ok ? messagesRes.data : { data: [], nextCursor: null, tunnelSessions: {} };

  return {
    username,
    messages: messagesData,
    tunnelSessions: (messagesData as { tunnelSessions?: Record<string, unknown> }).tunnelSessions ?? {},
    partnerDeviceKeys: partnerKeyRes.ok ? partnerKeyRes.data.keys : [],
    myDeviceKeys: myKeyRes.ok && myKeyRes.data ? myKeyRes.data.keys : [],
    partnerPresence: partnerProfileRes?.ok ? partnerProfileRes.data.presence ?? null : null,
    convInfo: convInfoRes?.ok ? convInfoRes.data : { status: null, isInboundRequest: false },
    // accessToken is passed to the client so TunnelTalk can make direct API calls.
    accessToken: locals.accessToken ?? null,
    pendingTunnel: pendingTunnelRes?.ok && pendingTunnelRes.data?.pending
      ? pendingTunnelRes.data.session
      : null,
  };
};

export const actions: Actions = {
  send: async ({ request, params, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');

    const form = await request.formData();
    // The client encrypts before submitting; `body` is the v3 ciphertext.
    const messageBody = form.get('body')?.toString() ?? '';
    if (!messageBody) return fail(422, { error: 'Message cannot be empty' });

    const res = await apiFetch(`/messages/${params.username}`, {
      method: 'POST',
      token: locals.accessToken,
      body: { body: messageBody },
    });

    if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Failed to send message' });

    // Return the stored message so the client can swap out the optimistic
    // placeholder immediately without waiting for the live socket echo.
    // No redirect here — skipping the full page refetch is what makes send feel instant.
    return { message: res.data as DirectMessage };
  },

  // Accepts an inbound message request, switching it to an active conversation.
  accept: async ({ params, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    const res = await apiFetch(`/messages/${params.username}/accept`, {
      method: 'POST',
      token: locals.accessToken,
    });
    if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Could not accept request' });
    throw redirect(303, `/messages/${params.username}`);
  },

  // Deletes all messages in the conversation but leaves the conversation row so
  // either party can start a fresh thread from the same entry point.
  clear: async ({ params, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    await apiFetch(`/messages/${params.username}/messages`, {
      method: 'DELETE',
      token: locals.accessToken,
    });
    throw redirect(303, `/messages/${params.username}`);
  },

  // Removes the conversation and all its messages permanently for both parties.
  deleteConversation: async ({ params, locals }) => {
    if (!locals.accessToken) throw redirect(303, '/login');
    await apiFetch(`/messages/${params.username}`, {
      method: 'DELETE',
      token: locals.accessToken,
    });
    throw redirect(303, '/messages');
  },

  // Called once from the client after generating a new local key pair. The
  // public key is stored server-side per device so senders can encrypt for
  // every registered device.
  registerKey: async ({ request, locals }) => {
    if (!locals.accessToken) return fail(401, { error: 'Not authenticated' });

    const form = await request.formData();
    const deviceId = form.get('deviceId')?.toString() ?? '';
    const publicKey = form.get('publicKey')?.toString() ?? '';
    if (!deviceId || !publicKey) return fail(400, { error: 'deviceId and publicKey required' });

    const res = await apiFetch('/auth/keys', {
      method: 'POST',
      token: locals.accessToken,
      body: { deviceId, publicKey },
    });

    if (!res.ok) return fail(res.status, { error: res.error?.message ?? 'Key registration failed' });
    return { ok: true };
  },
};
