// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Live notification fan-out, the in-app counterpart to apns.ts / webpush.ts.
 *
 * Where those deliver a notification to a backgrounded device, this pushes it to
 * a client the user has open right now, over the per-user NotificationHub
 * Durable Object, so the bell badge and notification list update without a
 * reload. It serializes the just-created notification the same way the REST list
 * does, so the client renders it with no extra fetch.
 *
 * Best-effort, like the other channels: it no-ops when the Durable Object isn't
 * bound (the Bun dev server) or the user has nothing open, and never throws back
 * into the action that created the notification.
 */
import { serializeUsers, serializePosts, serializeConversationRefs } from './serialize.ts';
import { getWorkerBindings } from '../lib/bindings.ts';
import type { NotificationType } from '@counter/config';
import type { Notification, NotificationLiveSignal } from '@counter/types';

/** The just-created notification row, in the minimal shape this needs to hydrate. */
export interface LiveNotificationInput {
  id: string;
  type: NotificationType;
  actorId: string;
  postId: string | null;
  conversationId: string | null;
  createdAt: string;
}

/**
 * Push one notification to every client the recipient has open.
 *
 * @returns How many sockets it reached. Zero when nothing's open or the hub
 *   isn't bound. The caller doesn't gate background push on this: a live socket
 *   open on one device shouldn't silence a push to another, so de-duplication is
 *   handled per-device on the client instead.
 */
export async function deliverLiveNotification(
  recipientId: string,
  n: LiveNotificationInput,
): Promise<number> {
  const ns = getWorkerBindings()?.NOTIFICATION_HUB;
  if (!ns) return 0;

  // Hydrate the actor (and post/conversation when present) exactly like the
  // notification list endpoint, so the client gets a ready-to-render object.
  const [actors, posts, convs] = await Promise.all([
    serializeUsers([n.actorId], recipientId),
    n.postId ? serializePosts([n.postId], recipientId) : Promise.resolve(new Map()),
    n.conversationId
      ? serializeConversationRefs([n.conversationId], recipientId)
      : Promise.resolve(new Map()),
  ]);

  const actor = actors.get(n.actorId);
  // No actor (deleted/blocked) means there's nothing to show, same as the list.
  if (!actor) return 0;

  const notification: Notification = {
    id: n.id,
    type: n.type,
    actor,
    post: n.postId ? posts.get(n.postId) ?? null : null,
    conversation: n.conversationId ? convs.get(n.conversationId) ?? null : null,
    read: false,
    createdAt: n.createdAt,
  };

  const stub = ns.get(ns.idFromName(recipientId));
  const res = await stub.fetch('https://hub/broadcast', {
    method: 'POST',
    body: JSON.stringify({ type: 'notification', notification } satisfies NotificationLiveSignal),
  });
  const { delivered } = (await res.json()) as { delivered: number };
  return delivered;
}
