// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Shapes for the private messaging layer: individual messages and the
 * conversation threads they live in.
 *
 * A conversation is always between exactly two users. The API returns the
 * partner (the other participant) relative to whoever is making the request,
 * so callers never have to figure out which side they're on.
 */
import { z } from 'zod';
import { MESSAGE } from '@counter/config';
import type { PublicUser } from './user.ts';
import type { TunnelSession } from './tunnel.ts';

/** One message sent in a private conversation. */
export interface DirectMessage {
  id: string;
  sender: PublicUser;
  /**
   * The message body. When `encrypted` is true this is the raw ciphertext from
   * the database (`v2:` single-device or `v3:` multi-device format); the client
   * finds the copy for its device and decrypts locally. When false the server
   * already returned plaintext (legacy v1 or pre-encryption rows).
   *
   * Empty string for `kind: 'screenshot'` entries; the body has no meaning there.
   */
  body: string;
  /** Whether the recipient has read this message. Always true for messages you sent. */
  read: boolean;
  /** True when `body` holds E2EE ciphertext that the client must decrypt. */
  encrypted: boolean;
  /**
   * `'message'` for normal messages. `'screenshot'` when the viewer took a
   * screenshot. `'cleared'` when a participant cleared their history.
   * `'deleted'` when a participant deleted the conversation.
   * `'tunnel_started'` / `'tunnel_ended'` are system markers for a Tunnel Talk
   * session; body is empty and `tunnelSessionId` links them to the session record.
   */
  kind: 'message' | 'screenshot' | 'cleared' | 'deleted' | 'tunnel_started' | 'tunnel_ended';
  /**
   * Set only on `tunnel_started` and `tunnel_ended` messages. Links the marker
   * to its `TunnelSession` so the thread view can look up and display the
   * transcript (or the asterisk placeholder when nothing was saved).
   */
  tunnelSessionId: string | null;
  createdAt: string;
}

/**
 * One registered device key: a P-256 key pair that a specific device has
 * registered so other users can encrypt messages for it. Senders encrypt a
 * separate copy of each message for every entry in the recipient's key list.
 */
export interface DeviceKey {
  /** Stable UUID generated on the device; used to find the right copy when decrypting. */
  deviceId: string;
  /** SPKI base64-encoded P-256 public key. */
  publicKey: string;
}

/**
 * A conversation between the viewer and one other user, as it appears in the
 * inbox. `partner` is always the other participant; `lastMessage` is the most
 * recent message for the preview line.
 */
export interface Conversation {
  id: string;
  partner: PublicUser;
  lastMessage: DirectMessage | null;
  /** Count of unread messages from the partner in this conversation. */
  unreadCount: number;
  /** When the last message was sent; drives inbox sort order. */
  lastMessageAt: string;
  createdAt: string;
  /**
   * 'active' for a normal two-way conversation. 'request' means the initiator
   * sent one message and is waiting for the recipient to accept.
   */
  status: 'active' | 'request';
  /**
   * True when this is an inbound message request — the viewer is the recipient,
   * not the one who sent the request. The viewer can accept or decline it.
   * False for active conversations and for requests the viewer sent.
   */
  isInboundRequest: boolean;
}

/**
 * Realtime signals carried over the per-conversation WebSocket, served by the
 * ConversationHub Durable Object. One socket per open thread, shared by live
 * messages, typing indicators, and in-thread presence.
 *
 * Direction is the thing to keep straight. `message` only ever flows server to
 * client: a message is written to the database and pushed out after it commits,
 * so the socket never carries unsaved content and the recipient decrypts the
 * same ciphertext it would have fetched. `typing` flows client to server to the
 * other peer and is never stored anywhere. `presence` and `presence_state` are
 * derived by the DO from which sockets are currently connected, so they cost no
 * database reads and leave no trail.
 */
export type LiveSignal =
  | { type: 'message'; message: DirectMessage }
  | { type: 'typing'; userId: string; on: boolean }
  | { type: 'presence'; userId: string; online: boolean }
  // Sent once to a socket the moment it connects, so a freshly opened thread
  // can paint the partner's presence dot without waiting for their next change.
  | { type: 'presence_state'; online: string[] }
  // An incoming Tunnel Talk invite, pushed to the recipient's open thread so the
  // join banner appears live instead of on a poll. Carries the session to join.
  | { type: 'tunnel_invite'; session: TunnelSession };

/**
 * The only thing a client may send up the conversation socket. Messages don't
 * go this way, they go through the REST send endpoint so they're persisted and
 * trigger notifications; the socket is for the ephemeral typing signal alone.
 * The DO stamps the sender's userId from the socket itself, so the client never
 * supplies one (and can't spoof another user's typing state).
 */
export type LiveClientSignal = { type: 'typing'; on: boolean };

/**
 * Lightweight metadata about a single conversation thread, returned by
 * `GET /messages/:username/info`. Used by the thread page to decide whether
 * to show a request banner or compose box without a full message fetch.
 */
export interface ConversationInfo {
  /** Null when no conversation between these two users exists yet. */
  status: 'active' | 'request' | null;
  /** True when this is an inbound request the viewer can accept or decline. */
  isInboundRequest: boolean;
}

/**
 * Input schema for sending a message.
 *
 * The body max is the encrypted ceiling, not the plaintext limit. Plaintext
 * length is validated client-side before encryption; the server only checks
 * that the stored blob isn't unreasonably large.
 */
export const sendMessageSchema = z.object({
  body: z
    .string()
    .min(1, 'Message cannot be empty')
    .max(MESSAGE.MAX_ENCRYPTED_BODY_LENGTH, 'Message body is too large'),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/** Input schema for registering or rotating an E2EE key for one device. */
export const registerPublicKeySchema = z.object({
  /** Stable UUID the device generated and persisted locally. */
  deviceId: z.string().min(1),
  /** SPKI base64-encoded P-256 public key generated on the client device. */
  publicKey: z.string().min(1),
});

export type RegisterPublicKeyInput = z.infer<typeof registerPublicKeySchema>;
