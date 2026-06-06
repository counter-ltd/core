// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * WebRTC peer connection for Tunnel Talk.
 *
 * Wraps RTCPeerConnection and RTCDataChannel into a single class that speaks
 * the Tunnel Talk data-channel protocol. All message content stays on this
 * channel: it never reaches the signaling server or any other Counter endpoint.
 *
 * E2EE: messages are encrypted with the same P-256 ECDH + AES-256-GCM scheme
 * used for regular DMs. The ciphertext format is identical, so the existing
 * encryptForDevices / decryptMessage functions work unchanged.
 *
 * Transcript buffering: when both parties consent, messages are appended to
 * `sentBuffer` (sent) or `receivedBuffer` (received). The caller uploads them
 * after the session ends via POST /tunnel/:sessionId/transcript.
 */

import { encryptForDevices, decryptMessage } from '$lib/e2ee';
import type { DeviceKey, SignalingMessage, DataChannelMessage, IceCandidateInit } from '@counter/types';

/** A decrypted message ready to display in the Tunnel Talk UI. */
export interface TunnelChatMessage {
  tempId: string;
  body: string;
  /** True when the local user sent this message. */
  mine: boolean;
  sentAt: Date;
}

/** A ciphertext entry saved for transcript upload. */
export interface TranscriptEntry {
  body: string;
  sentAt: string; // ISO 8601
}

export class TunnelPeer {
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private privateKey: CryptoKey;
  private myDeviceId: string;
  private partnerDeviceKeys: DeviceKey[];
  private myDeviceKeys: DeviceKey[];

  // Buffered ICE candidates queued before remote description is set.
  private pendingIce: RTCIceCandidateInit[] = [];

  // Transcript buffers — only populated when both parties consent.
  sentBuffer: TranscriptEntry[] = [];
  receivedBuffer: TranscriptEntry[] = [];

  /** Fires when the data channel opens (P2P connection established). */
  onConnected: (() => void) | null = null;
  /** Fires when the data channel closes (peer left or connection lost). */
  onDisconnected: (() => void) | null = null;
  /** Fires when ICE negotiation fails and the connection cannot be established. */
  onConnectionFailed: (() => void) | null = null;
  /**
   * Fires as the ICE negotiation progresses, with a human-readable label
   * describing the current phase. Useful for showing sub-step feedback during
   * the "Establishing link…" stage.
   *
   * @param label - Short phrase describing the current ICE phase.
   */
  onIceStatus: ((label: string) => void) | null = null;
  /** Fires for each decrypted message received from the remote peer. */
  onMessage: ((msg: TunnelChatMessage) => void) | null = null;
  /**
   * Fires when the remote peer sends a consent change.
   * @param value - Whether the remote peer has enabled transcript saving.
   */
  onConsent: ((value: boolean) => void) | null = null;
  /** Fires when the remote peer ends the session. */
  onEnd: (() => void) | null = null;
  /**
   * Fires with a signaling message that must be forwarded to the remote peer
   * via the TunnelSignaling WebSocket.
   */
  onSignal: ((msg: SignalingMessage) => void) | null = null;

  constructor(opts: {
    iceServers: RTCIceServer[];
    privateKey: CryptoKey;
    myDeviceId: string;
    partnerDeviceKeys: DeviceKey[];
    myDeviceKeys: DeviceKey[];
  }) {
    this.privateKey = opts.privateKey;
    this.myDeviceId = opts.myDeviceId;
    this.partnerDeviceKeys = opts.partnerDeviceKeys;
    this.myDeviceKeys = opts.myDeviceKeys;

    this.pc = new RTCPeerConnection({ iceServers: opts.iceServers });

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.onSignal?.({ type: 'ice', candidate: candidate.toJSON() as IceCandidateInit });
      }
    };

    // 'failed' is terminal: ICE gave up after exhausting all candidate pairs.
    // Without this handler the UI stays stuck on "Connecting…" indefinitely.
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed') {
        this.onConnectionFailed?.();
      }
    };

    this.pc.onicegatheringstatechange = () => {
      switch (this.pc.iceGatheringState) {
        case 'gathering':
          this.onIceStatus?.('Gathering network candidates…');
          break;
        case 'complete':
          this.onIceStatus?.('Candidates gathered, testing paths…');
          break;
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      switch (this.pc.iceConnectionState) {
        case 'checking':
          this.onIceStatus?.('Checking connection paths…');
          break;
        case 'disconnected':
          // Transient — browser will try to recover before firing 'failed'.
          this.onIceStatus?.('Connection interrupted, trying to recover…');
          break;
      }
    };

    // The participant side receives the data channel rather than creating it.
    this.pc.ondatachannel = ({ channel }) => {
      this.wireChannel(channel);
    };
  }

  /**
   * Initiator flow: create the data channel, generate an SDP offer.
   *
   * The returned offer SDP must be sent to the remote peer via the signaling
   * channel. Wait for `receiveAnswer` before the data channel can open.
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    // Create the channel before the offer so it's included in the SDP.
    const ch = this.pc.createDataChannel('tunnel', { ordered: true });
    this.wireChannel(ch);

    this.onIceStatus?.('Creating offer…');
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  /**
   * Participant flow: receive the initiator's offer and return an answer SDP.
   *
   * The returned answer must be sent back to the initiator via the signaling
   * channel. The data channel fires `onConnected` once the initiator sets it.
   */
  async receiveOffer(sdp: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    this.onIceStatus?.('Received offer, sending answer…');
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.drainPendingIce();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  /**
   * Initiator flow: set the answer received from the participant.
   *
   * Call this after receiving the answer via the signaling channel.
   */
  async receiveAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    this.onIceStatus?.('Answer received, waiting for connection…');
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.drainPendingIce();
  }

  /**
   * Feed an ICE candidate received from the remote peer via the signaling channel.
   *
   * Candidates that arrive before the remote description is set are queued and
   * applied once it is available.
   */
  async receiveIce(candidate: IceCandidateInit): Promise<void> {
    if (this.pc.remoteDescription) {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      // Remote description not set yet; queue and drain later.
      this.pendingIce.push(candidate);
    }
  }

  /**
   * Encrypt and send a message to the remote peer over the data channel.
   *
   * The message is encrypted with the partner's device keys (and the sender's
   * own keys so their other devices can read it too). Ciphertext is appended
   * to `sentBuffer` if `bufferSent` is true.
   *
   * @param plaintext - The raw text the user typed.
   * @param tempId - Client-generated ID echoed back in the `delivered` ack.
   * @param bufferSent - Whether to add to the transcript buffer.
   */
  async sendMessage(plaintext: string, tempId: string, bufferSent: boolean): Promise<void> {
    const allTargetKeys = [...this.partnerDeviceKeys, ...this.myDeviceKeys];
    const body = await encryptForDevices(plaintext, allTargetKeys, this.myDeviceKeys);

    this.channelSend({ type: 'message', body, tempId });

    if (bufferSent) {
      this.sentBuffer.push({ body, sentAt: new Date().toISOString() });
    }
  }

  /**
   * Send a consent state change to the remote peer.
   *
   * @param value - True when enabling transcript saving, false when revoking.
   */
  sendConsent(value: boolean): void {
    this.channelSend({ type: 'consent', value });
  }

  /** Send an end signal and close the peer connection. */
  end(): void {
    try {
      this.channelSend({ type: 'end' });
    } catch {
      // Channel might already be closing.
    }
    this.pc.close();
  }

  // --- signaling ingestion ---

  /** Route a signaling message received from the TunnelSignaling WebSocket. */
  receiveSignal(msg: SignalingMessage): void {
    if (msg.type === 'offer') {
      // Answer the offer and send it back through signaling. Without emitting
      // the answer here the initiator never sets a remote description and the
      // connection never completes.
      void this.receiveOffer(msg).then((answer) => {
        this.onSignal?.({ type: 'answer', sdp: answer.sdp ?? '' });
      });
    } else if (msg.type === 'answer') {
      void this.receiveAnswer(msg);
    } else if (msg.type === 'ice') {
      void this.receiveIce(msg.candidate);
    }
    // peer_joined and peer_left are handled by TunnelSignaling, not here.
  }

  // --- private helpers ---

  private wireChannel(ch: RTCDataChannel): void {
    this.channel = ch;

    ch.onopen = () => {
      this.onConnected?.();
    };

    ch.onclose = () => {
      this.onDisconnected?.();
    };

    ch.onmessage = ({ data }) => {
      void this.handleChannelMessage(data as string);
    };
  }

  private async handleChannelMessage(raw: string): Promise<void> {
    let msg: DataChannelMessage;
    try {
      msg = JSON.parse(raw) as DataChannelMessage;
    } catch {
      return;
    }

    if (msg.type === 'message') {
      // Decrypt then surface to the UI.
      let plaintext: string;
      try {
        plaintext = await decryptMessage(msg.body, this.privateKey, this.myDeviceId);
      } catch {
        plaintext = '[Could not decrypt message]';
      }

      // Buffer the received ciphertext if consent is active. The body is stored
      // (not the plaintext) so the server receives the same ciphertext format
      // as regular DMs, which the recipient can later decrypt.
      this.receivedBuffer.push({ body: msg.body, sentAt: new Date().toISOString() });

      this.onMessage?.({
        tempId: msg.tempId,
        body: plaintext,
        mine: false,
        sentAt: new Date(),
      });

      // Acknowledge delivery so the sender can show the tick.
      this.channelSend({ type: 'delivered', tempId: msg.tempId });
    } else if (msg.type === 'consent') {
      this.onConsent?.(msg.value);
    } else if (msg.type === 'end') {
      this.pc.close();
      this.onEnd?.();
    }
    // 'delivered' acks are not surfaced to the UI in this version.
  }

  private channelSend(msg: DataChannelMessage): void {
    if (this.channel?.readyState === 'open') {
      this.channel.send(JSON.stringify(msg));
    }
  }

  private async drainPendingIce(): Promise<void> {
    for (const candidate of this.pendingIce) {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
    this.pendingIce = [];
  }
}
