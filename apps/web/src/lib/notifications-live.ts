// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * WebSocket client for the per-user notification feed (the NotificationHub
 * Durable Object).
 *
 * One per signed-in session, opened in the root layout so it spans the whole
 * app. It carries the live notification feed: a new like, follow, reply,
 * mention, or message arrives here the moment it's created, so the nav badges
 * and lists update without a reload. The channel is one-way (server to client);
 * the client never sends anything up it.
 *
 * Reconnects on drop with capped backoff, since it's meant to stay open as long
 * as the tab is. Call `close()` on teardown.
 */

import { env } from '$env/dynamic/public';
import type { Notification, NotificationLiveSignal } from '@counter/types';

/** Build the wss URL, carrying the access token in the query (no WS headers). */
function toWsUrl(token: string): string {
  const base = env.PUBLIC_API_URL || 'http://localhost:3000';
  const wsBase = base.replace(/^https?/, (p) => (p === 'https' ? 'wss' : 'ws'));
  return `${wsBase}/notifications/live?token=${encodeURIComponent(token)}`;
}

/**
 * Long-lived WebSocket connection to the user's notification stream.
 * Construct once per session and assign `onNotification` to react to
 * incoming events. Call `close()` when the session ends.
 */
export class NotificationsLive {
  private ws: WebSocket | null = null;
  private token: string;
  private retries = 0;
  private closed = false;

  /** A new notification was created for this user. */
  onNotification: ((n: Notification) => void) | null = null;

  constructor(token: string) {
    this.token = token;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(toWsUrl(this.token));
    this.ws = ws;

    ws.onopen = () => {
      this.retries = 0;
    };

    ws.onmessage = (event) => {
      let signal: NotificationLiveSignal;
      try {
        signal = JSON.parse(event.data as string) as NotificationLiveSignal;
      } catch {
        // Malformed frames from the server are a no-op; don't crash the feed.
        return;
      }
      if (signal.type === 'notification') this.onNotification?.(signal.notification);
    };

    ws.onclose = () => {
      if (this.closed) return;
      // Exponential backoff capped at 30 s so a prolonged disconnect doesn't
      // stretch reconnect attempts out indefinitely.
      const delay = Math.min(1000 * 2 ** this.retries, 30_000);
      this.retries++;
      setTimeout(() => this.connect(), delay);
    };
  }

  /** Close for good; the hub hibernates once the user's last socket drops. */
  close(): void {
    this.closed = true;
    this.ws?.close(1000, 'signed_out');
    this.ws = null;
  }
}
