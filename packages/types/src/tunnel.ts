// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Types for Tunnel Talk: peer-to-peer ephemeral chat sessions.
 *
 * Two layers of communication exist: the signaling channel (WebSocket through
 * the server-side Durable Object, used only to exchange WebRTC SDP and ICE
 * candidates) and the data channel (WebRTC RTCDataChannel, direct P2P once
 * the connection is established). The server never sees data channel content.
 */

import { z } from 'zod';
import type { PublicUser } from './user.ts';

/**
 * A Tunnel Talk session record returned by the API.
 *
 * Status flows: pending → active → ended, or pending → declined.
 * SDP and ICE signals are never stored; they exist only transiently in the
 * signaling Durable Object during connection setup.
 */
export interface TunnelSession {
  id: string;
  conversationId: string;
  /** The user who sent the invite. */
  initiator: PublicUser;
  /** The user who received the invite. */
  participant: PublicUser;
  /** Current lifecycle state of the session. */
  status: 'pending' | 'active' | 'ended' | 'declined';
  /**
   * Whether the initiator has opted in to saving the transcript.
   * Both must be true before any messages are buffered for upload.
   */
  initiatorConsent: boolean;
  /** Whether the participant has opted in to saving the transcript. */
  participantConsent: boolean;
  /** When the WebRTC data channel opened (both peers connected). Null until then. */
  startedAt: string | null;
  /** When either peer ended the session. Null while active. */
  endedAt: string | null;
  createdAt: string;
}

/**
 * One message from an uploaded Tunnel Talk transcript.
 *
 * Bodies are the same E2EE ciphertext format as regular DMs. The client
 * decrypts locally; the server stored opaque bytes.
 */
export interface TunnelMessage {
  id: string;
  sender: PublicUser;
  /** E2EE ciphertext in v2 or v3 format, same as DirectMessage.body. */
  body: string;
  /** When the message was sent over the P2P channel, not when it was uploaded. */
  sentAt: string;
}

/**
 * A session with its transcript, used in the extended `GET /messages/:username`
 * response so the thread view can render inline transcripts between markers.
 */
export interface TunnelSessionWithTranscript extends TunnelSession {
  /**
   * Uploaded transcript messages in chronological order.
   * Empty when neither party consented, or after revocation.
   */
  messages: TunnelMessage[];
}

// --- Signaling protocol (server-relayed, never stored) ---

/**
 * Messages sent over the signaling WebSocket during WebRTC connection setup.
 * The Durable Object relays these verbatim between the two peers and discards
 * them immediately — nothing is written to the database.
 */
/**
 * Inlined from the WebRTC spec so this package doesn't require DOM lib types.
 * The signaling DO and non-browser environments receive this as opaque JSON.
 */
export interface IceCandidateInit {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type SignalingMessage =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: IceCandidateInit }
  | { type: 'peer_joined' }
  | { type: 'peer_left' };

// --- Data channel protocol (P2P, never touches server) ---

/**
 * Messages sent over the WebRTC RTCDataChannel between the two peers.
 * These never reach Counter's servers.
 */
export type DataChannelMessage =
  | {
      type: 'message';
      /** E2EE ciphertext produced by encryptForDevices. */
      body: string;
      /** Client-generated ID for deduplication and delivery acks. */
      tempId: string;
    }
  | {
      type: 'delivered';
      /** Echoed back by the receiver to ack a message. */
      tempId: string;
    }
  | {
      type: 'consent';
      /** Whether the sender is turning transcript saving on or off. */
      value: boolean;
    }
  | { type: 'end' };

// --- API input schemas ---

/**
 * Body for `POST /tunnel/:sessionId/transcript`.
 *
 * Clients upload their locally buffered messages after the session ends,
 * only when they consented. Each entry uses the client-recorded timestamp
 * from when the message was sent P2P, not the upload time.
 */
export const uploadTranscriptSchema = z.object({
  messages: z.array(
    z.object({
      /** E2EE ciphertext as sent over the data channel. */
      body: z.string().min(1),
      /** ISO 8601 timestamp from when the message was sent P2P. */
      sentAt: z.string().datetime(),
    }),
  ),
});

export type UploadTranscriptInput = z.infer<typeof uploadTranscriptSchema>;

/** TURN server credentials returned by `GET /tunnel/turn-credentials`. */
export interface TurnCredentials {
  /** STUN/TURN URLs to pass directly to RTCConfiguration.iceServers. */
  urls: string[];
  username: string;
  credential: string;
}
