// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Thing Two Discord bot routes. Handles the authenticated settings endpoints
 * (GET/PUT /discord-bot/settings) and the unauthenticated Discord interactions
 * webhook (POST /discord-bot/interactions), which processes slash commands,
 * message context menus, and the initial PING handshake. Requests to the
 * interactions endpoint are verified by Ed25519 signature rather than Counter JWT.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { db, discordBotSubscriptions, oauthAccounts, eq, and } from '@counter/db';
import { loadServerEnv } from '@counter/config/env';
import { body } from '../lib/validate.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import {
  checkGuildMembership,
} from '../services/discord-bot.ts';
import {
  verifyDiscordSignature,
  handlePostCommand,
  handleShareCommand,
  handleInteractCommand,
  handleAskCommand,
  handleCreateAppCommand,
  type DiscordInteraction,
} from '../services/discord-post.ts';
import type { AppEnv } from '../types.ts';

export const discordBotRoutes = new Hono<AppEnv>();

// --- settings (authenticated) ---

discordBotRoutes.use('/settings', requireAuth);

const updateSchema = z.object({
  enabled: z.boolean(),
  postingEnabled: z.boolean().optional(),
});

discordBotRoutes.get('/settings', async (c) => {
  const userId = requireUserId(c);
  const row = await db.query.discordBotSubscriptions.findFirst({
    where: eq(discordBotSubscriptions.userId, userId),
  });

  // Absence means the user has never interacted with the toggle: treat as off.
  return c.json({
    enabled: row?.enabled ?? false,
    inGuild: row?.inGuild ?? false,
    guildCheckedAt: row?.guildCheckedAt?.toISOString() ?? null,
    postingEnabled: row?.postingEnabled ?? false,
  });
});

discordBotRoutes.put('/settings', async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, updateSchema);
  const env = loadServerEnv();

  if (input.enabled) {
    // Enabling notifications requires a connected Discord account.
    const oauthRow = await db.query.oauthAccounts.findFirst({
      where: and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, 'discord')),
    });

    if (!oauthRow) {
      return c.json(
        { error: { code: 'discord_not_connected', message: 'Connect your Discord account first.' } },
        400,
      );
    }

    // Check guild membership. Skip in local dev when bot credentials aren't set.
    let inGuild = true;
    if (env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID) {
      try {
        inGuild = await checkGuildMembership(
          env.DISCORD_BOT_TOKEN,
          env.DISCORD_GUILD_ID,
          oauthRow.providerUserId,
        );
      } catch {
        return c.json(
          { error: { code: 'discord_error', message: 'Could not verify Counter server membership.' } },
          502,
        );
      }

      if (!inGuild) {
        return c.json(
          { error: { code: 'not_in_guild', message: 'Join the Counter Discord server first.' } },
          403,
        );
      }
    }

    const now = new Date();
    await db
      .insert(discordBotSubscriptions)
      .values({
        userId,
        enabled: true,
        inGuild,
        guildCheckedAt: now,
        postingEnabled: input.postingEnabled ?? false,
      })
      .onConflictDoUpdate({
        target: discordBotSubscriptions.userId,
        set: {
          enabled: true,
          inGuild,
          guildCheckedAt: now,
          // Only update postingEnabled when the caller explicitly included it.
          ...(input.postingEnabled !== undefined ? { postingEnabled: input.postingEnabled } : {}),
          updatedAt: now,
        },
      });
  } else {
    // Disabling notifications never needs a guild check. postingEnabled can
    // still be toggled independently while notifications stay off.
    const now = new Date();
    await db
      .insert(discordBotSubscriptions)
      .values({
        userId,
        enabled: false,
        postingEnabled: input.postingEnabled ?? false,
      })
      .onConflictDoUpdate({
        target: discordBotSubscriptions.userId,
        set: {
          enabled: false,
          ...(input.postingEnabled !== undefined ? { postingEnabled: input.postingEnabled } : {}),
          updatedAt: now,
        },
      });
  }

  const row = await db.query.discordBotSubscriptions.findFirst({
    where: eq(discordBotSubscriptions.userId, userId),
  });

  return c.json({
    enabled: row?.enabled ?? false,
    inGuild: row?.inGuild ?? false,
    guildCheckedAt: row?.guildCheckedAt?.toISOString() ?? null,
    postingEnabled: row?.postingEnabled ?? false,
  });
});

// --- Discord interactions webhook (no Counter auth) ---

/** Discord interaction types we handle. */
const INTERACTION_TYPE = {
  PING: 1,
  APPLICATION_COMMAND: 2,
} as const;

/** Discord application command types. */
const COMMAND_TYPE = {
  CHAT_INPUT: 1,
  MESSAGE: 3,
} as const;

discordBotRoutes.post('/interactions', async (c) => {
  const env = loadServerEnv();

  // If the public key isn't configured, the endpoint is inoperable. Return 501
  // rather than 401 so it's obvious this is a configuration gap, not an auth
  // failure on a legitimate request.
  if (!env.DISCORD_PUBLIC_KEY) {
    return c.json({ error: 'Discord interactions not configured' }, 501);
  }

  const signature = c.req.header('x-signature-ed25519') ?? '';
  const timestamp = c.req.header('x-signature-timestamp') ?? '';
  const rawBody = await c.req.text();

  const valid = await verifyDiscordSignature(
    env.DISCORD_PUBLIC_KEY,
    signature,
    timestamp,
    rawBody,
  );

  if (!valid) {
    return c.json({ error: 'Invalid request signature' }, 401);
  }

  const interaction = JSON.parse(rawBody) as DiscordInteraction;

  // PING: Discord sends this when you register the interactions URL to confirm
  // we're alive and responding correctly. Must reply with type 1 (PONG).
  if (interaction.type === INTERACTION_TYPE.PING) {
    return c.json({ type: 1 });
  }

  if (interaction.type === INTERACTION_TYPE.APPLICATION_COMMAND) {
    const name = interaction.data?.name;
    const commandType = interaction.data?.type ?? COMMAND_TYPE.CHAT_INPUT;

    if (name === 'post' && commandType === COMMAND_TYPE.CHAT_INPUT) {
      const response = await handlePostCommand(interaction);
      return c.json(response);
    }

    if (name === 'interact' && commandType === COMMAND_TYPE.CHAT_INPUT) {
      const response = await handleInteractCommand(interaction);
      return c.json(response);
    }

    if (name === 'ask' && commandType === COMMAND_TYPE.CHAT_INPUT) {
      // The model call outlives the 3s deadline, so the handler ACKs now and
      // finishes via waitUntil. Bind it so the Worker stays alive for the followup.
      const response = handleAskCommand(
        interaction,
        env,
        c.executionCtx.waitUntil.bind(c.executionCtx),
      );
      return c.json(response);
    }

    if (name === 'create-app' && commandType === COMMAND_TYPE.CHAT_INPUT) {
      const response = await handleCreateAppCommand(interaction, {
        DISCORD_BOT_TOKEN: env.DISCORD_BOT_TOKEN,
        DISCORD_GUILD_ID: env.DISCORD_GUILD_ID,
      });
      return c.json(response);
    }

    if (name === 'Share to Counter' && commandType === COMMAND_TYPE.MESSAGE) {
      const response = await handleShareCommand(interaction);
      return c.json(response);
    }
  }

  // Unknown command or interaction type; acknowledge without acting.
  return c.json({ type: 1 });
});
