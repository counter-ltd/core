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
   */
  kind: 'message' | 'screenshot' | 'cleared' | 'deleted';
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
