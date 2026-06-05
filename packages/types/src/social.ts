// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Shapes for the social layer that sits on top of posts: notifications, the
 * per-type notification preferences, push-device registration, and trending tags.
 */
import { z } from 'zod';
import { NOTIFICATION_TYPES, DEVICE_PLATFORMS } from '@counter/config';
import type { NotificationType } from '@counter/config';
import type { PublicUser } from './user.ts';
import type { Post } from './post.ts';

/**
 * Just enough of a conversation to deep-link a `message` notification straight
 * to the right thread. `partner` is the other participant, so the client can
 * show "X sent you a message" without a second fetch.
 */
export interface ConversationRef {
  id: string;
  partner: PublicUser;
}

/** One notification: who did what, and the post or conversation it concerns. */
export interface Notification {
  id: string;
  type: NotificationType; // like / repost / reply / follow / mention / message
  actor: PublicUser; // the user whose action triggered this
  post: Post | null; // the post involved; null for post-less events like a follow
  // The conversation involved; set only for `message`, null otherwise. Lets the
  // client route a message notification to the thread instead of the post view.
  conversation: ConversationRef | null;
  read: boolean;
  createdAt: string;
}

/**
 * What the per-user notification socket (the NotificationHub Durable Object)
 * pushes down when something happens. One shape today: a freshly created
 * notification, fully serialized so the client can render it and bump its badges
 * without a refetch. Kept a discriminated union so new live events (read-sync,
 * count corrections) can be added later without breaking older clients.
 */
export type NotificationLiveSignal = { type: 'notification'; notification: Notification };

/**
 * Unread badge counts for the nav, returned by `GET /notifications/badges`.
 * Fetched once on load to seed the badges; the live socket keeps them current
 * after that.
 */
export interface BadgeCounts {
  /** Unread notifications (everything except direct messages). */
  notifications: number;
  /** Unread direct messages across all conversations. */
  messages: number;
}

/**
 * A user's notification toggles: one boolean per type, true meaning "send me
 * these". A muted type produces no inbox row and no push, so this is the single
 * switch that governs every channel.
 */
export type NotificationPreferences = Record<NotificationType, boolean>;

/**
 * Body for `PUT /notifications/preferences`. Every type is optional so a client
 * can send just the toggles that changed; omitted types keep their current
 * setting. The keys are pinned to NOTIFICATION_TYPES so adding a type to the
 * constant surfaces here as a type error until it's handled.
 */
export const notificationPreferencesSchema = z.object(
  Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, z.boolean().optional()])) as Record<
    NotificationType,
    z.ZodOptional<z.ZodBoolean>
  >,
);
export type UpdateNotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;

/** Body for `POST /devices`: the platform push token to register for the caller. */
export const registerDeviceSchema = z.object({
  // Opaque APNs device token. We never decode it, only forward it to Apple.
  token: z.string().min(1).max(512),
  platform: z.enum(DEVICE_PLATFORMS),
  // User-visible label so multiple devices are distinguishable in the privacy panel.
  name: z.string().min(1).max(100).optional(),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

/**
 * Body for `POST /web-push/subscribe`: a browser PushSubscription as returned by
 * `subscription.toJSON()`. The endpoint is the push service URL; `keys.p256dh`
 * and `keys.auth` are the RFC 8291 inputs the server needs to encrypt payloads.
 */
export const webPushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});
export type WebPushSubscribeInput = z.infer<typeof webPushSubscribeSchema>;

/** Body for `DELETE /web-push/subscribe`: the endpoint to remove. */
export const webPushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});
export type WebPushUnsubscribeInput = z.infer<typeof webPushUnsubscribeSchema>;

/**
 * A registered push device returned by `GET /devices`. The raw token is
 * omitted from the response because it isn't useful to display and the delete
 * endpoint accepts the device `id` instead.
 */
export interface DeviceRecord {
  id: string;
  platform: string;
  name: string | null;
  createdAt: string;
  lastSeenAt: string;
}

/** A hashtag currently trending, with how many posts are driving it. */
export interface TrendingTag {
  name: string;
  postCount: number;
}

/**
 * Thing Two Discord bot notification subscription state for the caller.
 * Returned by `GET /discord-bot/settings`.
 */
export interface DiscordBotSettings {
  enabled: boolean;
  /** Whether the user was in the Counter Discord server at last check. */
  inGuild: boolean;
  /** ISO timestamp of the last guild membership check, or null if never checked. */
  guildCheckedAt: string | null;
  /** Whether the user has opted in to posting to Counter from Discord. */
  postingEnabled: boolean;
}
