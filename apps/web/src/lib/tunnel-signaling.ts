// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * WebSocket client for the Tunnel Talk signaling Durable Object.
 *
 * This class handles only the SDP/ICE exchange that sets up the WebRTC peer
 * connection. It does not carry any message content — that goes through the
 * RTCDataChannel directly between devices, never touching this connection.
 *
 * Once the data channel opens, call `close()` to release the server-side DO
 * connection. The DO hibernates automatically when both sockets close.
 */

import { env } from '$env/dynamic/public';
import type { SignalingMessage } from '@counter/types';

/** Convert an HTTP(S) API base URL to its WebSocket equivalent. */
function toWsUrl(sessionId: string, token: string): string {
  const base = env.PUBLIC_API_URL || 'http://localhost:3000';
  // Replace protocol only; path and params are appended as-is.
  const wsBase = base.replace(/^https?/, (p) => (p === 'https' ? 'wss' : 'ws'));
  return `${wsBase}/tunnel/${sessionId}/signal?token=${encodeURIComponent(token)}`;
}

export class TunnelSignaling {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private token: string;
  private retries = 0;
  private closed = false;

  /** Called when the remote peer joins (their WebSocket connected to the DO). */
  onPeerJoined: (() => void) | null = null;
  /** Called when the remote peer leaves (socket closed or sent peer_left). */
  onPeerLeft: (() => void) | null = null;
  /** Called for offer, answer, and ice messages that WebRTC needs. */
  onSignal: ((msg: SignalingMessage) => void) | null = null;

  constructor(sessionId: string, token: string) {
    this.sessionId = sessionId;
    this.token = token;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(toWsUrl(this.sessionId, this.token));
    this.ws = ws;

    ws.onmessage = (event) => {
      let msg: SignalingMessage;
      try {
        msg = JSON.parse(event.data as string) as SignalingMessage;
      } catch {
        return;
      }

      if (msg.type === 'peer_joined') {
        this.onPeerJoined?.();
      } else if (msg.type === 'peer_left') {
        this.onPeerLeft?.();
      } else {
        // offer, answer, ice — feed to WebRTC.
        this.onSignal?.(msg);
      }
    };

    ws.onerror = () => {
      // The close event fires immediately after; handle retry there.
    };

    ws.onclose = () => {
      if (this.closed) return;
      // Exponential backoff with a cap. Signaling is only needed during setup
      // (a few seconds), so 3 retries covers transient drops without lingering.
      if (this.retries < 3) {
        const delay = Math.min(500 * 2 ** this.retries, 4000);
        this.retries++;
        setTimeout(() => this.connect(), delay);
      } else {
        this.onPeerLeft?.();
      }
    };
  }

  /**
   * Send a signaling message to the remote peer via the DO relay.
   *
   * Only valid while the WebSocket is open. Silently drops if the socket
   * isn't ready yet — ICE candidates can arrive before the answer is set;
   * the caller should queue them if ordering matters.
   */
  send(msg: SignalingMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Permanently close the signaling channel.
   *
   * Call this once the WebRTC data channel is open — the peers no longer need
   * the signaling relay and the DO can hibernate.
   */
  close(): void {
    this.closed = true;
    this.ws?.close(1000, 'peer_left');
    this.ws = null;
  }
}
