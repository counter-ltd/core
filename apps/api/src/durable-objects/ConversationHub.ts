// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Live channel for one private conversation.
 *
 * One Durable Object instance per conversation, keyed by the two participants'
 * sorted user ids so both sides resolve to the same hub without a database
 * lookup. Each open thread (every tab, every device) holds one hibernatable
 * WebSocket here. The hub carries three things and nothing else:
 *
 *   - messages: pushed server to client after a message has already been written
 *     to the database by the REST send route. The hub fans the stored row out to
 *     connected sockets so the recipient sees it without polling. It never sees
 *     plaintext: E2EE bodies pass through as the same ciphertext the client would
 *     have fetched, and the hub forwards them untouched.
 *   - typing: relayed client to client and never stored. A patched client can't
 *     leak typing the user disabled, because the live route stamps a per-socket
 *     "may type" flag from the sender's privacy setting and the hub drops typing
 *     frames from sockets that don't have it.
 *   - presence: derived purely from which sockets are connected. No timers, no
 *     writes, no trail. A socket opening means "in this thread now"; the last one
 *     for a user closing means "gone".
 *
 * This keeps the realtime layer inside the platform's no-individual-tracking
 * rule: the only durable record of a conversation is the messages table, exactly
 * as before. Typing and presence live and die with the socket.
 *
 * Auth happens in the HTTP route before the upgrade is forwarded here. The hub
 * trusts the userId and canType query params that route set.
 */

import type { LiveSignal, LiveClientSignal } from '@counter/types';

/**
 * Per-socket tags, in order: the connected user's id, then '1'/'0' for whether
 * their privacy setting permits sending typing. Stamped in fetch() so they
 * survive hibernation (a local Map would be empty after a cold wake).
 */
type SocketTags = [userId: string, canType: string];

export class ConversationHub {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /**
   * Entry point for everything routed to this hub.
   *
   * Two shapes arrive here. A WebSocket upgrade (a participant opening the
   * thread) gets accepted with the hibernatable API. A plain POST to /broadcast
   * is the REST send route handing us a freshly persisted message to fan out;
   * only same-Worker code can reach that path, since no public route maps to it.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/broadcast')) {
      return this.handleBroadcast(request);
    }

    // A same-Worker presence probe: "does this user have the thread open right
    // now?" Answered straight off the connected sockets, no timers or writes, so
    // it stays inside the no-tracking rule. The Discord DM channel uses it to
    // skip pinging a thread the user is already reading live (see discord-bot).
    if (url.pathname.endsWith('/presence')) {
      const target = url.searchParams.get('userId');
      const online =
        !!target &&
        this.state.getWebSockets().some((ws) => this.state.getTags(ws)[0] === target);
      return Response.json({ online });
    }

    const userId = url.searchParams.get('userId');
    if (!userId) {
      return Response.json({ error: 'Missing userId' }, { status: 400 });
    }
    // The route passes canType=1 when the user's typing-indicator setting is on.
    // Absent or anything else is treated as off, so the safe default is no leak.
    const canType = url.searchParams.get('canType') === '1' ? '1' : '0';

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    this.state.acceptWebSocket(server, [userId, canType]);

    // Tell the new socket who's already here so it can paint the presence dot
    // immediately, then tell everyone else this user just arrived.
    this.sendPresenceState(server);
    this.broadcastExcept(userId, { type: 'presence', userId, online: true });

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Fan a server-originated signal out to connected sockets.
   *
   * Called by the REST routes via a stub fetch: the send route pushes a freshly
   * committed message (to everyone, since the sender's tabs dedupe by id), and
   * the Tunnel Talk invite route pushes the invite to the recipient only, which
   * it marks with `?except=<initiatorId>` so the inviter's own thread doesn't
   * surface their own invite.
   */
  private async handleBroadcast(request: Request): Promise<Response> {
    let signal: LiveSignal;
    try {
      signal = (await request.json()) as LiveSignal;
    } catch {
      return Response.json({ error: 'Bad payload' }, { status: 400 });
    }
    if (!signal || typeof signal.type !== 'string') {
      return Response.json({ error: 'Bad payload' }, { status: 400 });
    }

    const except = new URL(request.url).searchParams.get('except');
    const payload = JSON.stringify(signal);
    for (const ws of this.state.getWebSockets()) {
      if (except && this.state.getTags(ws)[0] === except) continue;
      try {
        ws.send(payload);
      } catch {
        // Socket already closed; nothing to do.
      }
    }
    return Response.json({ ok: true });
  }

  /**
   * Called by the runtime when a client sends on any hibernated socket.
   *
   * Only the typing signal is accepted; messages never travel this way. We
   * re-stamp the userId from the socket's own tag so a client can't claim to be
   * someone else, and drop the frame entirely when that socket's privacy flag
   * says typing is off.
   */
  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
    const [userId, canType] = this.state.getTags(ws) as SocketTags;
    if (!userId) return;
    if (canType !== '1') return;

    let msg: LiveClientSignal;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : '') as LiveClientSignal;
    } catch {
      return;
    }
    if (msg.type !== 'typing') return;

    this.broadcastExcept(userId, { type: 'typing', userId, on: !!msg.on });
  }

  /**
   * Called when a socket closes. If it was the user's last one in this hub,
   * tell the other side they've left so a stale typing bubble or presence dot
   * can clear at once instead of waiting on a timeout.
   */
  webSocketClose(ws: WebSocket): void {
    const [userId] = this.state.getTags(ws) as SocketTags;
    if (!userId) return;

    // The closing socket may still be listed here depending on timing, so count
    // only sockets for this user that aren't the one closing.
    const stillHere = this.state
      .getWebSockets()
      .some((peer) => peer !== ws && (this.state.getTags(peer)[0] === userId));
    if (stillHere) return;

    // Clearing typing alongside the offline signal avoids a bubble sticking
    // around if the user closed the tab mid-type.
    this.broadcastExcept(userId, { type: 'typing', userId, on: false });
    this.broadcastExcept(userId, { type: 'presence', userId, online: false });
  }

  /**
   * Tell one socket which *other* users are currently connected.
   *
   * The target's own id is filtered out so the client doesn't have to know its
   * own user id to tell whether the partner is here: a non-empty list means the
   * other side has the thread open.
   */
  private sendPresenceState(target: WebSocket): void {
    const selfId = this.state.getTags(target)[0];
    const online = [
      ...new Set(
        this.state
          .getWebSockets()
          .map((ws) => this.state.getTags(ws)[0])
          .filter((id) => id && id !== selfId),
      ),
    ] as string[];
    try {
      target.send(JSON.stringify({ type: 'presence_state', online } satisfies LiveSignal));
    } catch {
      // Socket closed before we could greet it; harmless.
    }
  }

  /**
   * Send a signal to every connected socket whose user isn't the sender.
   *
   * Using getWebSockets() rather than a local map means this stays correct
   * after the hub wakes from hibernation.
   */
  private broadcastExcept(senderId: string, signal: LiveSignal): void {
    const payload = JSON.stringify(signal);
    for (const ws of this.state.getWebSockets()) {
      if (this.state.getTags(ws)[0] === senderId) continue;
      try {
        ws.send(payload);
      } catch {
        // Socket already closed; nothing to do.
      }
    }
  }
}
