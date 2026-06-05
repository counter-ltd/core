// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * WebSocket client for a conversation's live channel (the ConversationHub
 * Durable Object).
 *
 * One of these per open thread. It surfaces three things the page would
 * otherwise only learn by reloading: a new message arriving, the partner
 * typing, and the partner opening or closing the thread. Messages still go out
 * through the normal REST send endpoint; this socket only carries the typing
 * signal upward, and everything else flows down from the server.
 *
 * It reconnects on drop with capped backoff, because unlike the short-lived
 * Tunnel Talk signaling socket this one is meant to stay open for as long as the
 * thread is on screen. Call `close()` when the component unmounts.
 */

import { env } from '$env/dynamic/public';
import type { DirectMessage, LiveSignal, LiveClientSignal, TunnelSession } from '@counter/types';

/** Build the wss URL for a conversation, carrying the access token in the query. */
function toWsUrl(username: string, token: string): string {
  const base = env.PUBLIC_API_URL || 'http://localhost:3000';
  const wsBase = base.replace(/^https?/, (p) => (p === 'https' ? 'wss' : 'ws'));
  return `${wsBase}/messages/${encodeURIComponent(username)}/live?token=${encodeURIComponent(token)}`;
}

export class ConversationLive {
  private ws: WebSocket | null = null;
  private username: string;
  private token: string;
  private retries = 0;
  private closed = false;

  /** A new message was pushed (the partner's, or a copy of one you sent elsewhere). */
  onMessage: ((msg: DirectMessage) => void) | null = null;
  /** The partner started or stopped typing. */
  onTyping: ((on: boolean) => void) | null = null;
  /** The partner opened or closed this thread. */
  onPresence: ((online: boolean) => void) | null = null;
  /** The partner sent a Tunnel Talk invite. */
  onTunnelInvite: ((session: TunnelSession) => void) | null = null;

  constructor(username: string, token: string) {
    this.username = username;
    this.token = token;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(toWsUrl(this.username, this.token));
    this.ws = ws;

    ws.onopen = () => {
      // A clean open resets backoff so the next drop retries promptly.
      this.retries = 0;
    };

    ws.onmessage = (event) => {
      let signal: LiveSignal;
      try {
        signal = JSON.parse(event.data as string) as LiveSignal;
      } catch {
        return;
      }
      switch (signal.type) {
        case 'message':
          this.onMessage?.(signal.message);
          break;
        case 'typing':
          this.onTyping?.(signal.on);
          break;
        case 'presence':
          this.onPresence?.(signal.online);
          break;
        case 'presence_state':
          // A non-empty list means the partner already has the thread open.
          this.onPresence?.(signal.online.length > 0);
          break;
        case 'tunnel_invite':
          this.onTunnelInvite?.(signal.session);
          break;
      }
    };

    ws.onclose = () => {
      if (this.closed) return;
      // Capped exponential backoff. The thread stays useful from its loaded
      // state while disconnected, so there's no rush, but keep trying so a brief
      // network blip heals on its own.
      const delay = Math.min(1000 * 2 ** this.retries, 30_000);
      this.retries++;
      setTimeout(() => this.connect(), delay);
    };
  }

  /**
   * Tell the partner whether you're typing. Dropped silently if the socket
   * isn't open; a missed keystroke signal is never worth surfacing an error.
   * The server ignores this entirely when the user has typing indicators off.
   */
  setTyping(on: boolean): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'typing', on } satisfies LiveClientSignal));
    }
  }

  /** Close the channel for good. The hub hibernates once both sides drop. */
  close(): void {
    this.closed = true;
    this.ws?.close(1000, 'thread_closed');
    this.ws = null;
  }
}
