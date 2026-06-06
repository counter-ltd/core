// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Live notification channel for one user.
 *
 * One Durable Object instance per user, keyed by their id, so every place they
 * have Counter open (web tabs, the iOS app) shares a single hub. Each open
 * client holds one hibernatable WebSocket here. When a notification is created
 * for the user, the REST path hands it to this hub and the hub fans it out to
 * those sockets, so the bell badge and lists update live instead of only on the
 * next reload or a background push.
 *
 * This is the global counterpart to ConversationHub: that one is per
 * conversation and carries messages/typing/presence; this one is per user and
 * carries the notification feed. It holds nothing durable, a notification is
 * already saved in the notifications table before it reaches here, so the hub is
 * pure fan-out and leaves no trail of its own.
 *
 * Auth happens in the HTTP route before the upgrade is forwarded here, and the
 * hub is keyed by the user's own id, so every socket on it belongs to that user.
 */

import type { NotificationLiveSignal } from '@counter/types';

/** Durable Object that fans live notification signals out to all open sockets for one user. */
export class NotificationHub {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /**
   * Entry point for everything routed to this hub.
   *
   * A WebSocket upgrade (a client opening the app) is accepted with the
   * hibernatable API. A plain POST to /broadcast is the REST path handing us a
   * freshly created notification to fan out; only same-Worker code reaches it.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/broadcast')) {
      return this.handleBroadcast(request);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Fan a notification signal out to every connected socket for this user. */
  private async handleBroadcast(request: Request): Promise<Response> {
    let signal: NotificationLiveSignal;
    try {
      signal = (await request.json()) as NotificationLiveSignal;
    } catch {
      return Response.json({ error: 'Bad payload' }, { status: 400 });
    }

    const payload = JSON.stringify(signal);
    let delivered = 0;
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload);
        delivered++;
      } catch {
        // Socket already closed; nothing to do.
      }
    }
    // The count lets the caller decide whether a background push is still needed.
    return Response.json({ delivered });
  }

  /** Clients don't send anything up this channel; ignore whatever arrives. */
  webSocketMessage(): void {}
}
