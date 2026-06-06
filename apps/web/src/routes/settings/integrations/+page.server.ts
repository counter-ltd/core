// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Integrations section: the Thing Two Discord bot (notification DMs and
 * post-from-Discord). Needs to know whether Discord is linked, since neither
 * toggle works until it is.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { OAuthConnectedAccount, DiscordBotSettings } from '@counter/types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
  if (!locals.user) throw redirect(303, '/login');
  const [discordRes, discordBotRes] = await Promise.all([
    apiFetch<OAuthConnectedAccount>('/auth/discord/me', { token: locals.accessToken, fetch }),
    apiFetch<DiscordBotSettings>('/discord-bot/settings', { token: locals.accessToken, fetch }),
  ]);
  return {
    discordAccount: discordRes.ok ? discordRes.data : null,
    discordBotSettings: discordBotRes.ok
      ? discordBotRes.data
      : { enabled: false, inGuild: false, guildCheckedAt: null, postingEnabled: false },
  };
};

export const actions: Actions = {
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
};
