<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Full-screen Tunnel Talk overlay.
   *
   * Manages the complete lifecycle of a P2P session: signaling setup,
   * WebRTC connection, message display, transcript consent, and teardown.
   * All message content travels through the RTCDataChannel — this component
   * never sends message bodies to any server.
   *
   * Transcript upload (POST /tunnel/:sessionId/transcript) is triggered after
   * the session ends, only when the local user consented.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import { env } from '$env/dynamic/public';
  import { TunnelSignaling } from '$lib/tunnel-signaling';
  import { TunnelPeer } from '$lib/tunnel-p2p';
  import type { TunnelChatMessage } from '$lib/tunnel-p2p';
  import type { DeviceKey, SignalingMessage, TurnCredentials } from '@counter/types';

  // All API calls in this component go directly to the API (not through
  // SvelteKit server actions) because TunnelTalk is purely client-side.
  const API = env.PUBLIC_API_URL || 'http://localhost:3000';

  let {
    sessionId,
    accessToken,
    partnerUsername,
    isInitiator,
    privateKey,
    myDeviceId,
    partnerDeviceKeys,
    myDeviceKeys,
    onend,
  }: {
    sessionId: string;
    accessToken: string;
    partnerUsername: string;
    isInitiator: boolean;
    privateKey: CryptoKey;
    myDeviceId: string;
    partnerDeviceKeys: DeviceKey[];
    myDeviceKeys: DeviceKey[];
    /** Called after the session is fully closed and the overlay should be removed. */
    onend: () => void;
  } = $props();

  type ConnectionState = 'connecting' | 'connected' | 'ended' | 'error';

  // More specific label shown inside the "Connecting…" badge so the user can
  // tell whether the hang is in signaling or ICE negotiation.
  type ConnectingStage = 'relay' | 'waiting' | 'linking';
  const CONNECTING_LABEL: Record<ConnectingStage, string> = {
    relay:   'Connecting to relay…',
    waiting: `Waiting for @${partnerUsername}…`,
    linking: 'Establishing link…',
  };

  let connState: ConnectionState = $state('connecting');
  let connectingStage: ConnectingStage = $state('relay');
  let messages: TunnelChatMessage[] = $state([]);
  let draft = $state('');
  let myConsent = $state(false);
  let partnerConsent = $state(false);
  let errorMsg: string | null = $state(null);
  let listEl: HTMLElement;

  // If we haven't connected within 30 s, surface an error rather than hanging.
  let connectTimeout: ReturnType<typeof setTimeout> | null = null;
  // Sub-step label updated by TunnelPeer as ICE negotiation progresses.
  let iceDetail = $state<string | null>(null);

  let signaling: TunnelSignaling | null = null;
  let peer: TunnelPeer | null = null;

  // ICE candidate queue: candidates that arrive from the signaling channel
  // before the peer object is ready are held here and fed in once it's set up.
  const pendingSignals: SignalingMessage[] = [];

  onMount(async () => {
    connectTimeout = setTimeout(() => {
      if (connState === 'connecting') {
        connState = 'error';
        errorMsg = 'Could not establish a connection. Check your network and try again.';
      }
    }, 30_000);

    try {
      await setup();
    } catch (e) {
      connState = 'error';
      errorMsg = e instanceof Error ? e.message : 'Connection failed';
    }
  });

  onDestroy(() => {
    if (connectTimeout) clearTimeout(connectTimeout);
    signaling?.close();
    peer?.end();
  });

  async function setup(): Promise<void> {
    // Fetch short-lived TURN credentials before opening any WebRTC connection.
    // Stale credentials cause silent ICE failures, so we always fetch fresh ones.
    const turnRes = await fetch(`${API}/tunnel/turn-credentials`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!turnRes.ok) throw new Error('Failed to fetch TURN credentials');
    const turnData = (await turnRes.json()) as TurnCredentials;

    const iceServers: RTCIceServer[] = [
      {
        urls: turnData.urls,
        ...(turnData.username ? { username: turnData.username, credential: turnData.credential } : {}),
      },
    ];

    peer = new TunnelPeer({
      iceServers,
      privateKey,
      myDeviceId,
      partnerDeviceKeys,
      myDeviceKeys,
    });

    peer.onConnected = () => {
      if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
      connState = 'connected';
      // Once P2P is up the signaling relay is no longer needed.
      signaling?.close();
    };

    peer.onConnectionFailed = () => {
      connState = 'error';
      errorMsg = 'Peer-to-peer connection failed. A firewall or strict NAT may be blocking the link.';
    };

    peer.onIceStatus = (label) => {
      iceDetail = label;
    };

    peer.onDisconnected = () => {
      if (connState !== 'ended') endSession(false);
    };

    peer.onMessage = async (msg) => {
      messages = [...messages, msg];
      // Scroll to bottom after the DOM updates.
      await tick();
      listEl?.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' });
    };

    peer.onConsent = (value) => {
      partnerConsent = value;
    };

    peer.onEnd = () => {
      endSession(false);
    };

    peer.onSignal = (msg) => {
      signaling?.send(msg);
    };

    // Drain any candidates that arrived before the peer was ready.
    for (const sig of pendingSignals) {
      peer.receiveSignal(sig);
    }
    pendingSignals.length = 0;

    // Open the signaling WebSocket after the peer is wired up so no signals
    // are dropped between creating the peer and attaching the handler.
    connectingStage = 'waiting';
    signaling = new TunnelSignaling(sessionId, accessToken);

    signaling.onSignal = (msg) => {
      if (peer) {
        peer.receiveSignal(msg);
      } else {
        pendingSignals.push(msg);
      }
    };

    signaling.onPeerJoined = async () => {
      // Both peers are on the signaling relay — ICE negotiation starts now.
      connectingStage = 'linking';
      // The initiator creates the offer; the participant waits for it via onSignal.
      if (isInitiator && peer) {
        const offer = await peer.createOffer();
        signaling?.send({ type: 'offer', sdp: offer.sdp ?? '' });
      }
    };

    signaling.onPeerLeft = () => {
      if (connState !== 'ended') endSession(false);
    };

    // If we're not the initiator we don't create the offer — just wait.
    // But if we're the initiator and the participant joined before us, onPeerJoined
    // fires immediately on our side when we connect, so this is covered.
  }

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text || connState !== 'connected' || !peer) return;
    draft = '';

    const tempId = crypto.randomUUID();
    const mine: TunnelChatMessage = { tempId, body: text, mine: true, sentAt: new Date() };
    messages = [...messages, mine];

    await tick();
    listEl?.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' });

    // Buffer for transcript only when both parties have consented.
    await peer.sendMessage(text, tempId, myConsent && partnerConsent);
  }

  async function toggleConsent(): Promise<void> {
    const next = !myConsent;

    if (!next) {
      // Revoking: warn the user before proceeding.
      if (!confirm('Turning this off will permanently delete the saved transcript for this session.')) {
        return;
      }
    }

    myConsent = next;
    peer?.sendConsent(next);

    // Sync to the server so the other party's upload is also gated on consent.
    await fetch(`${API}/tunnel/${sessionId}/consent`, {
      method: next ? 'PUT' : 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  async function endSession(local: boolean): Promise<void> {
    if (connState === 'ended') return;
    connState = 'ended';

    if (local) {
      peer?.end();
    }

    // Tell the server the session is over.
    await fetch(`${API}/tunnel/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // Upload transcript if this user consented. The peer sends separately.
    if (myConsent && peer && peer.sentBuffer.length > 0) {
      await fetch(`${API}/tunnel/${sessionId}/transcript`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: peer.sentBuffer }),
      });
    }

    onend();
  }

  function handleKeydown(e: KeyboardEvent): void {
    // Submit on Enter without Shift (same as the regular compose box).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }
</script>

<div class="tunnel-overlay">
  <div class="tunnel-panel panel">
    <!-- Header -->
    <div class="tunnel-head">
      <div class="tunnel-partner">
        <span class="mono">@{partnerUsername}</span>
        {#if connState === 'connecting'}
          <span class="status-badge connecting">
            {CONNECTING_LABEL[connectingStage]}
            {#if connectingStage === 'linking' && iceDetail}
              <span class="ice-detail">{iceDetail}</span>
            {/if}
          </span>
        {:else if connState === 'connected'}
          <span class="status-badge connected">● P2P</span>
        {:else if connState === 'ended'}
          <span class="status-badge ended">Ended</span>
        {:else}
          <span class="status-badge error">Error</span>
        {/if}
      </div>

      <div class="tunnel-controls">
        <!-- Consent toggle -->
        <Checkbox
          class="consent-toggle"
          title="Save transcript for both parties"
          checked={myConsent}
          disabled={connState !== 'connected'}
          onchange={toggleConsent}
        >Save</Checkbox>

        <button
          class="btn btn-sm btn-danger end-btn"
          onclick={() => endSession(true)}
          disabled={connState === 'ended'}
        >
          End
        </button>
      </div>
    </div>

    <!-- Partner consent notice -->
    {#if partnerConsent}
      <p class="partner-consent-notice faint">@{partnerUsername} is saving this session</p>
    {/if}

    <!-- Error state -->
    {#if connState === 'error'}
      <p class="error tunnel-error">{errorMsg}</p>
    {/if}

    <!-- Message list -->
    <div class="tunnel-messages" bind:this={listEl}>
      {#if messages.length === 0 && connState === 'connected'}
        <p class="faint empty-hint">Say something — messages go directly to @{partnerUsername}.</p>
      {/if}
      {#each messages as msg (msg.tempId)}
        <div class="tunnel-bubble" class:mine={msg.mine}>
          <span class="bubble-body">{msg.body}</span>
        </div>
      {/each}
    </div>

    <!-- Compose bar -->
    <div class="tunnel-compose">
      <textarea
        bind:value={draft}
        placeholder="Message…"
        rows="2"
        disabled={connState !== 'connected'}
        onkeydown={handleKeydown}
      ></textarea>
      <button
        class="btn btn-primary send-btn"
        disabled={connState !== 'connected' || !draft.trim()}
        onclick={() => void send()}
      >
        Send
      </button>
    </div>
  </div>
</div>

<style>
  /* Full-screen overlay above the conversation page */
  .tunnel-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    backdrop-filter: blur(6px);
  }

  .tunnel-panel {
    width: 100%;
    max-width: 560px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  /* Header row */
  .tunnel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-shrink: 0;
  }

  .tunnel-partner {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .tunnel-controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* Connection status badge */
  .status-badge {
    font-size: 0.72rem;
    font-family: var(--mono);
    padding: 2px 7px;
    border-radius: 999px;
    font-weight: 500;
  }
  .status-badge.connecting {
    background: var(--color-border);
    color: var(--color-text-dim);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }
  .ice-detail {
    font-size: 0.65rem;
    opacity: 0.75;
  }
  .status-badge.connected  { background: #14532d; color: #4ade80; }
  .status-badge.ended      { background: var(--color-border); color: var(--color-text-dim); }
  .status-badge.error      { background: #450a0a; color: #f87171; }

  /* Consent toggle */
  /* Layout and interaction are handled by Checkbox; only override the label size/colour.
     :global is required because the class lives on Checkbox's root element. */
  :global(.consent-toggle) {
    font-size: 0.82rem;
    color: var(--color-text-dim);
  }

  .partner-consent-notice {
    font-size: 0.78rem;
    text-align: center;
    margin: 0;
    flex-shrink: 0;
  }

  .tunnel-error {
    font-size: 0.85rem;
    flex-shrink: 0;
  }

  /* Scrollable message list */
  .tunnel-messages {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 200px;
    padding: var(--space-1) 0;
  }

  .empty-hint {
    text-align: center;
    font-size: 0.85rem;
    margin: auto;
  }

  .tunnel-bubble {
    max-width: 78%;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    background: var(--glass-bg);
    border: 1px solid var(--color-border);
    align-self: flex-start;
    word-break: break-word;
  }
  .tunnel-bubble.mine {
    align-self: flex-end;
    background: var(--color-accent-dim, rgba(99, 102, 241, 0.2));
    border-color: var(--color-accent, #6366f1);
  }

  .bubble-body {
    font-size: 0.92rem;
    white-space: pre-wrap;
  }

  /* Compose bar */
  .tunnel-compose {
    display: flex;
    gap: var(--space-2);
    align-items: flex-end;
    flex-shrink: 0;
  }

  .tunnel-compose textarea {
    flex: 1;
    resize: none;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    border: 1px solid var(--color-border);
    background: var(--glass-bg);
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.92rem;
    line-height: 1.4;
  }

  .send-btn {
    flex-shrink: 0;
    align-self: flex-end;
  }

  .end-btn {
    flex-shrink: 0;
  }
</style>
