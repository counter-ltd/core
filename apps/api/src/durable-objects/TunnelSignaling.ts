// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Signaling relay for Tunnel Talk peer-to-peer sessions.
 *
 * One Durable Object instance per active tunnel session. Its only job is to
 * relay WebRTC signaling messages (SDP offer/answer and ICE candidates) between
 * the two peers while they negotiate a direct connection. Once the WebRTC data
 * channel opens the peers communicate directly and this DO goes idle.
 *
 * The DO never inspects, stores, or logs message content. It cannot: messages
 * arrive as raw JSON blobs and leave the same way. SDP and ICE candidates are
 * discarded the moment they are forwarded.
 *
 * Auth and session validation happen in the HTTP route before the upgrade is
 * forwarded here. The DO trusts the userId query param set by that route.
 */

import type { SignalingMessage } from '@counter/types';

/** Tags attached to each WebSocket so we can look up the user on wake. */
type PeerTag = string; // the userId

export class TunnelSignaling {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /**
   * Entry point for all requests routed to this DO.
   *
   * The HTTP route forwards the WebSocket upgrade here after auth. We accept
   * the upgrade with the Hibernatable WebSocket API so the DO can sleep between
   * messages instead of holding an active isolate open for the session lifetime.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    if (!userId) {
      return Response.json({ error: 'Missing userId' }, { status: 400 });
    }

    // Only WebSocket upgrades reach this point; the Hono route rejects plain HTTP.
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Tag with userId so we can identify this connection after hibernation wakes.
    this.state.acceptWebSocket(server, [userId]);

    // Tell the other peer (if already connected) that this one joined.
    this.broadcast(userId, { type: 'peer_joined' });

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Called by the Workers runtime when a message arrives on any hibernated WS.
   *
   * We relay the message to the other peer verbatim. The only special case is
   * `peer_left`, which we handle the same as a close event to let either side
   * initiate a clean disconnect.
   */
  webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): void {
    const userId = this.state.getTags(ws)[0] as PeerTag | undefined;
    if (!userId) return;

    let msg: SignalingMessage;
    try {
      msg = JSON.parse(typeof rawMessage === 'string' ? rawMessage : '') as SignalingMessage;
    } catch {
      // Malformed JSON — drop silently. The client will time out waiting for ack.
      return;
    }

    // peer_left is a voluntary disconnect signal; treat it like a close so the
    // other peer gets notified even if the underlying WS stays open briefly.
    if (msg.type === 'peer_left') {
      ws.close(1000, 'peer_left');
      this.broadcast(userId, { type: 'peer_left' });
      return;
    }

    // Everything else (offer, answer, ice, peer_joined) goes straight across.
    this.broadcast(userId, msg);
  }

  /**
   * Called when a WebSocket closes, either cleanly or due to network loss.
   *
   * Notify the remaining peer so it can show a "disconnected" state rather than
   * waiting for a ping timeout.
   */
  webSocketClose(ws: WebSocket): void {
    const userId = this.state.getTags(ws)[0] as PeerTag | undefined;
    if (!userId) return;
    this.broadcast(userId, { type: 'peer_left' });
  }

  /**
   * Send a signaling message to every connected peer except the sender.
   *
   * In practice there are at most two peers, so "every peer except sender" means
   * exactly one recipient. Using getWebSockets() rather than a local Map means
   * this works correctly after the DO wakes from hibernation (local Map would be
   * empty after a cold wake).
   */
  private broadcast(senderId: PeerTag, msg: SignalingMessage): void {
    const payload = JSON.stringify(msg);
    for (const peer of this.state.getWebSockets()) {
      // getTags returns the userId we stamped on this socket in fetch().
      const peerId = this.state.getTags(peer)[0];
      if (peerId !== senderId) {
        try {
          peer.send(payload);
        } catch {
          // Socket already closed — nothing to do.
        }
      }
    }
  }
}
