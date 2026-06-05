// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Thing Two: Discord bot DM delivery for Counter notifications.
 *
 * When a user opts in and passes the guild membership check, every notification
 * they receive also arrives as a Discord DM from the bot. The notification row
 * is always the source of truth; this is a courtesy copy, same as APNs push.
 *
 * Delivery is best-effort: missing credentials no-op silently, and a 403/404
 * from Discord (user blocked the bot or left the server) disables the subscription
 * rather than throwing back into the request that triggered the notification.
 *
 * One extra suppression beyond the other channels: a message or Tunnel Talk
 * invite DM is skipped when the user already has that thread open live (web or
 * iOS), since the bot is a single external channel and pinging a thread you're
 * reading is just noise.
 */
import { loadServerEnv } from '@counter/config/env';
import { db, discordBotSubscriptions, oauthAccounts, users, eq, and } from '@counter/db';
import type { NotificationType } from '@counter/config';
import { getWorkerBindings } from '../lib/bindings.ts';
import type { PushPayload } from './apns.ts';

const DISCORD_API = 'https://discord.com/api/v10';

/** Human-readable DM text for each notification type. Mirrors apns.ts alertText. */
function dmText(type: NotificationType, actorName: string): string {
  switch (type) {
    case 'like':         return `${actorName} liked your post`;
    case 'repost':       return `${actorName} reposted your post`;
    case 'reply':        return `${actorName} replied to your post`;
    case 'follow':       return `${actorName} followed you`;
    case 'mention':      return `${actorName} mentioned you`;
    case 'message':      return `${actorName} sent you a message`;
    case 'tunnel_invite': return `${actorName} invited you to Tunnel Talk`;
  }
}

/**
 * Check whether a Discord user is a member of the Counter guild.
 *
 * Returns true on 200, false on 404 (not in guild), and throws on unexpected
 * status codes so the caller can surface them.
 *
 * @param botToken    Bot token to authenticate the guild member lookup.
 * @param guildId     The Counter Discord server ID.
 * @param discordUserId  The user's Discord snowflake ID.
 */
export async function checkGuildMembership(
  botToken: string,
  guildId: string,
  discordUserId: string,
): Promise<boolean> {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${discordUserId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  // Any other status (401, 403, 5xx) is unexpected — surface it.
  throw new Error(`Discord guild member check returned ${res.status}`);
}

/**
 * Send a DM to a Discord user via the bot.
 *
 * Discord requires opening a DM channel first, then posting to it. The channel
 * open is cheap and idempotent — Discord returns the same channel ID if one
 * already exists for the pair.
 *
 * Returns false when the user has blocked the bot or left the server (403/404),
 * true on success, throws on unexpected errors.
 *
 * @param botToken      Bot token for authentication.
 * @param discordUserId Discord snowflake ID of the recipient.
 * @param content       Plain-text message body.
 */
async function sendDm(botToken: string, discordUserId: string, content: string): Promise<boolean> {
  const authHeader = { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' };

  // Open (or reuse) the DM channel with this user.
  const channelRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({ recipient_id: discordUserId }),
  });

  if (channelRes.status === 403 || channelRes.status === 404) return false;
  if (!channelRes.ok) throw new Error(`Discord DM channel open returned ${channelRes.status}`);

  const channel = await channelRes.json() as { id: string };

  const msgRes = await fetch(`${DISCORD_API}/channels/${channel.id}/messages`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({ content }),
  });

  if (msgRes.status === 403 || msgRes.status === 404) return false;
  if (!msgRes.ok) throw new Error(`Discord message send returned ${msgRes.status}`);

  return true;
}

/**
 * Is the recipient watching this conversation live right now?
 *
 * True only when they hold an open ConversationHub socket for the pair, which is
 * the case whenever the thread is in front of them in any client, web or iOS.
 * The hub keys on the two ids sorted, so we rebuild the same key from recipient
 * and actor without a database lookup.
 *
 * Best-effort: false when the hub isn't bound (the Bun dev server) or the probe
 * fails, so a missing signal never silences a DM that should have gone out.
 *
 * @param recipientId  Who would receive the DM.
 * @param actorId      The other side of the conversation (sender or inviter).
 */
async function isViewingConversation(recipientId: string, actorId: string): Promise<boolean> {
  const ns = getWorkerBindings()?.CONVERSATION_HUB;
  if (!ns) return false;
  const pairKey = [recipientId, actorId].sort().join(':');
  try {
    const stub = ns.get(ns.idFromName(pairKey));
    const res = await stub.fetch(`https://hub/presence?userId=${recipientId}`);
    const { online } = (await res.json()) as { online: boolean };
    return online;
  } catch {
    return false;
  }
}

/**
 * Deliver a notification as a Discord DM via Thing Two.
 *
 * No-ops when the bot isn't configured, the user hasn't opted in, they have no
 * linked Discord account, or (for messages and Tunnel Talk invites) they already
 * have the thread open live. On a 403/404 from Discord the subscription row is
 * automatically disabled so we don't keep attempting dead deliveries.
 *
 * @param userId   Recipient's Counter user ID.
 * @param payload  The same payload that goes to APNs.
 */
export async function deliverDiscordNotification(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  const env = loadServerEnv();
  // Skip entirely when the bot isn't set up (local dev, tests, no .dev.vars entry).
  if (!env.DISCORD_BOT_TOKEN) return;

  const [sub, oauthRow, actor] = await Promise.all([
    db.query.discordBotSubscriptions.findFirst({
      where: eq(discordBotSubscriptions.userId, userId),
    }),
    db.query.oauthAccounts.findFirst({
      where: and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, 'discord')),
    }),
    db.query.users.findFirst({ where: eq(users.id, payload.actorId) }),
  ]);

  if (!sub?.enabled) return;
  if (!oauthRow) return; // Discord disconnected after opting in; silently skip.

  // Don't DM about a thread the user is already reading live. A message or a
  // Tunnel Talk invite lands in front of them over the conversation socket, so
  // a Discord ping on top of that is pure noise. This is Discord-only on
  // purpose: APNs and web push deliberately still fire (a live socket on one
  // device shouldn't silence the locked phone in your pocket), but the bot is a
  // single external channel, so any active view anywhere means suppress.
  if (
    (payload.type === 'message' || payload.type === 'tunnel_invite') &&
    payload.conversationId &&
    (await isViewingConversation(userId, payload.actorId))
  ) {
    return;
  }

  const actorName = actor?.displayName || (actor ? `@${actor.username}` : 'Someone');
  const content = dmText(payload.type, actorName);

  let delivered: boolean;
  try {
    delivered = await sendDm(env.DISCORD_BOT_TOKEN, oauthRow.providerUserId, content);
  } catch {
    // Transient Discord API error; leave the subscription intact and try again
    // next time rather than disabling on a flaky response.
    return;
  }

  if (!delivered) {
    // The user blocked the bot or left the server. Disable so we stop attempting.
    await db
      .update(discordBotSubscriptions)
      .set({ enabled: false, inGuild: false, updatedAt: new Date() })
      .where(eq(discordBotSubscriptions.userId, userId));
  }
}
