// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * One-time script to register Thing Two's slash commands with Discord.
 *
 * Uses a bulk PUT so it's idempotent: running it again replaces the command
 * list rather than creating duplicates. Re-run whenever a command is added,
 * renamed, or removed.
 *
 * Usage:
 *   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... bun run apps/api/scripts/register-discord-commands.ts
 *
 * Env vars can also come from apps/api/.dev.vars for local use. When
 * DISCORD_GUILD_ID is set, commands register to that guild only and appear
 * instantly; without it they register globally and can take up to an hour to
 * show up in Discord clients.
 */

import { loadRootEnv } from '@counter/config/env';
import { registerDiscordCommands } from '../src/services/discord-post.ts';

loadRootEnv();

const appId = process.env.DISCORD_APP_ID ?? '';
const botToken = process.env.DISCORD_BOT_TOKEN ?? '';
const guildId = process.env.DISCORD_GUILD_ID || undefined;

if (!appId || !botToken) {
  console.error('DISCORD_APP_ID and DISCORD_BOT_TOKEN must be set.');
  process.exit(1);
}

try {
  await registerDiscordCommands(appId, botToken, guildId);
  console.log(
    guildId
      ? `Discord commands registered to guild ${guildId} (instant).`
      : 'Discord commands registered globally (may take up to an hour to appear).',
  );
} catch (err) {
  console.error('Registration failed:', err);
  process.exit(1);
}
