<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * E2EE conversation thread. Incoming messages with encrypted=true arrive as
   * v2/v3 ciphertexts and are decrypted on-device using the local private key.
   * Outgoing messages are encrypted client-side (v3 multi-device format) before
   * the form body ever reaches the server.
   *
   * The sender always receives copies of their own messages, encrypted for each
   * of their registered devices, so sent messages are readable everywhere.
   */
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import Avatar from '$lib/components/Avatar.svelte';
  import TunnelTalk from '$lib/components/TunnelTalk.svelte';
  import LinkPreview from '$lib/components/LinkPreview.svelte';
  import { ConversationLive } from '$lib/conversation-live';
  import { timeAgo, linkifyMessageBody } from '$lib/format';
  import { env } from '$env/dynamic/public';
  import {
    loadOrGenerateKeyPair,
    exportPublicKey,
    encryptForDevices,
    decryptMessage,
  } from '$lib/e2ee';
  import type { ActionData } from './$types';
  import type { DeviceKey, DirectMessage, TunnelSession, TunnelSessionWithTranscript } from '@counter/types';

  let { data, form }: { data: any; form: ActionData } = $props();

  const API = env.PUBLIC_API_URL || 'http://localhost:3000';

  // Active Tunnel Talk session — set when the user initiates or accepts an invite.
  let activeTunnel = $state<{ session: TunnelSession; isInitiator: boolean } | null>(null);

  // Whether an invite request is in flight (prevent double-click).
  let inviting = $state(false);
  let acceptingTunnel = $state(false);

  // Tunnel Talk invite that arrived live, after the page was already loaded.
  // The SSR load only catches an invite that existed at first paint, so without
  // this a recipient sitting on the thread would miss one that lands mid-view.
  let polledPending = $state<TunnelSession | null>(null);

  // Prefer a live-polled invite over the one baked in at page load.
  const pendingTunnel = $derived<TunnelSession | null>(polledPending ?? data.pendingTunnel);

  // Messages pushed over the live socket after the page loaded. Kept apart from
  // the SSR-loaded page so a reload stays the source of truth and these merge in
  // on top, deduped by id.
  let liveMessages = $state<DirectMessage[]>([]);
  // Sent messages awaiting server confirmation. Each has a temp id ("opt-<uuid>").
  // Replaced by the real DirectMessage returned in the action response, or
  // removed on failure so the user can retry.
  let optimisticMessages = $state<DirectMessage[]>([]);
  // Live thread state from the conversation socket: whether the partner has the
  // thread open and whether they're typing right now. Both default to the
  // server-rendered presence until the socket says otherwise.
  let partnerOnlineLive = $state<boolean | null>(null);
  let partnerTyping = $state(false);

  // SSR messages (newest-first) reversed to read top-to-bottom, then live
  // arrivals, then any optimistic placeholders at the tail. Deduped by id so a
  // message that appears in multiple sources only renders once.
  const chronological = $derived.by(() => {
    const base = [...data.messages.data].reverse();
    const seen = new Set(base.map((m) => m.id));
    const extra: DirectMessage[] = [];
    for (const m of [...liveMessages, ...optimisticMessages]) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      extra.push(m);
    }
    return [...base, ...extra];
  });

  // Prefer the live presence signal over the snapshot baked in at page load.
  const partnerOnline = $derived(partnerOnlineLive ?? data.partnerPresence?.isOnline ?? false);

  let textarea: HTMLTextAreaElement;
  let sending = $state(false);
  // Separate state for client-side encryption errors vs server-action errors.
  let encryptError = $state<string | null>(null);

  // Populated on mount once the local key pair is loaded.
  let decryptedBodies = $state(new Map<string, string>());
  let privateKey = $state<CryptoKey | null>(null);
  let deviceId = $state<string | null>(null);
  // Exported public key kept in state so the send path can always include the
  // current device in the sender targets, even if it hasn't been reflected in
  // the server's data.myDeviceKeys yet (e.g. first message after first load).
  let currentPublicKey = $state<string | null>(null);

  onMount(() => {
    document.body.classList.add('chat-page');
    return () => document.body.classList.remove('chat-page');
  });

  onMount(async () => {
    const setup = await loadOrGenerateKeyPair();
    privateKey = setup.keyPair.privateKey;
    deviceId = setup.deviceId;
    currentPublicKey = await exportPublicKey(setup.keyPair.publicKey);

    // Register when new OR when the server doesn't have this device's key yet.
    // The second condition catches the case where the previous registration
    // attempt failed silently (fire-and-forget) so subsequent loads retry it.
    const alreadyRegistered = (data.myDeviceKeys as DeviceKey[]).some(
      (k: DeviceKey) => k.deviceId === setup.deviceId,
    );

    if (setup.isNew || !alreadyRegistered) {
      try {
        const fd = new FormData();
        fd.set('deviceId', setup.deviceId);
        fd.set('publicKey', currentPublicKey);
        await fetch('?/registerKey', {
          method: 'POST',
          body: fd,
          headers: { 'x-sveltekit-action': 'true' },
        });
      } catch {
        // Registration failed; will retry on next page load.
      }
    }

    // Always refresh after setup: the SSR snapshot may be stale if devices were
    // added or removed since the page loaded. Stale myDeviceKeys means outgoing
    // messages encrypt for the wrong target set, so this is correctness not polish.
    await invalidateAll();
  });

  // An incoming Tunnel Talk invite that already existed when the page loaded
  // comes down with the SSR data; one that arrives while the thread is open
  // comes over the live socket below. No polling either way.

  // --- live conversation socket: messages, typing, presence, invites ---

  let live: ConversationLive | null = null;
  // Forces the partner's typing bubble off if their 'stopped' signal is lost
  // (tab killed mid-type). Refreshed on every 'on'.
  let typingClearTimer: ReturnType<typeof setTimeout> | null = null;
  // What we last told the partner, so we send one 'typing' per burst rather than
  // one per keystroke, plus a timer that sends 'stopped' once we go idle.
  let sentTyping = false;
  let typingIdleTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    if (!data.accessToken) return;

    const conn = new ConversationLive(data.username, data.accessToken);
    live = conn;

    conn.onMessage = (msg) => {
      // Skip anything already on screen. The send action now adds confirmed
      // messages to liveMessages directly, so the socket's echo of our own
      // sends lands here and gets dropped by the second check.
      if ((data.messages.data as DirectMessage[]).some((m) => m.id === msg.id)) return;
      if (liveMessages.some((m) => m.id === msg.id)) return;
      liveMessages = [...liveMessages, msg];
    };

    conn.onTyping = (on) => {
      partnerTyping = on;
      if (typingClearTimer) clearTimeout(typingClearTimer);
      if (on) typingClearTimer = setTimeout(() => (partnerTyping = false), 6000);
    };

    conn.onPresence = (online) => {
      partnerOnlineLive = online;
      // Someone who just left the thread can't still be typing in it.
      if (!online) partnerTyping = false;
    };

    conn.onTunnelInvite = (session) => {
      // Don't replace a session the user is already in or an invite already up.
      if (activeTunnel || pendingTunnel) return;
      polledPending = session;
    };

    return () => {
      conn.close();
      live = null;
      if (typingClearTimer) clearTimeout(typingClearTimer);
      if (typingIdleTimer) clearTimeout(typingIdleTimer);
    };
  });

  // Emit typing on input, throttled to one 'on' per active burst, with a short
  // idle timer that sends 'stopped' so the partner's bubble clears on a pause.
  function handleTypingInput(): void {
    if (!live) return;
    if (!sentTyping) {
      sentTyping = true;
      live.setTyping(true);
    }
    if (typingIdleTimer) clearTimeout(typingIdleTimer);
    typingIdleTimer = setTimeout(() => stopTyping(), 3000);
  }

  function handleKeydown(e: KeyboardEvent): void {
    // Enter sends; Shift+Enter inserts a newline as expected.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // requestSubmit() fires the submit event so use:enhance picks it up,
      // unlike form.submit() which bypasses event listeners entirely.
      textarea.form?.requestSubmit();
    }
  }

  /** Tell the partner we've stopped typing, if we'd said we were. */
  function stopTyping(): void {
    if (typingIdleTimer) {
      clearTimeout(typingIdleTimer);
      typingIdleTimer = null;
    }
    if (sentTyping) {
      sentTyping = false;
      live?.setTyping(false);
    }
  }

  // Re-runs whenever the key or message list changes. Only decrypts messages not
  // already in the cache so a single new arrival doesn't re-decrypt the whole
  // thread. The cache is per-id so it's correct across reorders or pagination.
  $effect(() => {
    const pk = privateKey;
    const did = deviceId;
    const msgs = chronological;
    if (!pk || !did) return;

    void (async () => {
      const toDecrypt = msgs.filter((m) => m.encrypted && !decryptedBodies.has(m.id));
      if (!toDecrypt.length) return;
      const updates = new Map(decryptedBodies);
      for (const msg of toDecrypt) {
        try {
          updates.set(msg.id, await decryptMessage(msg.body, pk, did));
        } catch {
          updates.set(msg.id, '[Encrypted with a previous key]');
        }
      }
      decryptedBodies = updates;
    })();
  });

  function displayBody(msg: DirectMessage): string {
    if (!msg.encrypted) return msg.body;
    return decryptedBodies.get(msg.id) ?? '🔒 Decrypting…';
  }

  /**
   * Extract all unique HTTPS/HTTP URLs from a message body. Trailing sentence
   * punctuation is stripped from each match. Returns an empty array when none
   * are found or when the body is still the decrypting placeholder.
   */
  function extractAllUrls(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];
    const cleaned = matches.map((u) => u.replace(/[.,!?)\]}'";:]+$/, ''));
    return [...new Set(cleaned)];
  }

  // Server-encrypted fallback: at least one party has no registered device
  // keys, so messages are AES-encrypted by the server rather than on-device.
  // Both users see a notice; the compose box stays open.
  const serverEncryptedFallback = $derived(
    data.partnerDeviceKeys.length === 0 || data.myDeviceKeys.length === 0,
  );

  // Request state derived from server load data.
  const isRequest = $derived(data.convInfo.status === 'request');
  // Viewer is the recipient: show accept/decline. Viewer is the sender: show pending notice.
  const isInboundRequest = $derived(data.convInfo.isInboundRequest);

  // Only meaningful when E2EE is active. Shows when only this device is
  // registered so the user knows other devices they open won't get copies.
  const singleDeviceWarning = $derived(
    !serverEncryptedFallback && data.myDeviceKeys.length <= 1,
  );

  // Encryption level drives the lock button colour and popover content.
  type EncryptionLevel = 'loading' | 'e2ee' | 'e2ee-single' | 'server';
  const encryptionLevel = $derived<EncryptionLevel>(
    data.partnerDeviceKeys == null
      ? 'loading'
      : serverEncryptedFallback
        ? 'server'
        : singleDeviceWarning
          ? 'e2ee-single'
          : 'e2ee',
  );

  const encryptionTitle: Record<EncryptionLevel, string> = {
    loading:       'Checking encryption',
    e2ee:          'End-to-end encrypted',
    'e2ee-single': 'End-to-end encrypted',
    server:        'Server encrypted',
  };

  const encryptionDetail: Record<EncryptionLevel, string> = {
    loading:       'Verifying encryption status.',
    'e2ee-single': "End-to-end encrypted, but only one of your devices is registered. Open Counter on your other devices so they receive copies of future messages.",
    server:        "One party hasn't set up encryption keys yet. Messages are encrypted in storage by Counter's servers, not on your device.",
    // e2ee shows the device table instead of a text string.
    e2ee:          '',
  };

  let showLockPopover = $state(false);
  // Tracks which destructive action is awaiting confirmation inside the popover.
  let confirmAction = $state<'clear' | 'delete' | null>(null);

  // --- Tunnel Talk actions ---

  async function inviteTunnel(): Promise<void> {
    if (!data.accessToken || inviting) return;
    inviting = true;
    try {
      const res = await fetch(`${API}/tunnel/${data.username}/invite`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.accessToken}` },
      });
      if (!res.ok) return;
      const json = (await res.json()) as { sessionId: string };
      // Optimistically open TunnelTalk as initiator; the server will set status
      // to 'active' once the participant accepts.
      activeTunnel = {
        session: { id: json.sessionId } as TunnelSession,
        isInitiator: true,
      };
    } finally {
      inviting = false;
    }
  }

  async function acceptTunnel(session: TunnelSession): Promise<void> {
    if (!data.accessToken || acceptingTunnel) return;
    acceptingTunnel = true;
    try {
      const res = await fetch(`${API}/tunnel/${session.id}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.accessToken}` },
      });
      if (!res.ok) return;
      activeTunnel = { session, isInitiator: false };
      // Clear the pending invite the same way decline does. The accept route
      // flipped the row to active, so the next poll returns pending:false, but
      // polledPending lingers until then; without this the banner comes back
      // the moment the call overlay closes and activeTunnel resets to null.
      polledPending = null;
    } finally {
      acceptingTunnel = false;
    }
  }

  async function declineTunnel(session: TunnelSession): Promise<void> {
    if (!data.accessToken) return;
    await fetch(`${API}/tunnel/${session.id}/decline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.accessToken}` },
    });
    // Drop the live banner now. The server marks it declined, so the next poll
    // returns pending:false and won't bring it back.
    polledPending = null;
  }
</script>

<svelte:head><title>@{data.username} · Messages · Counter</title></svelte:head>

<div class="chat">
  <div class="head spread">
    <a href="/messages" class="back faint">← Messages</a>
    <div class="head-right">
      <div class="partner-info">
        <a href="/{data.username}" class="partner-link">
          @{data.username}
          {#if partnerOnline}
            <span class="online-dot" title="Online now" aria-label="Online"></span>
          {/if}
        </a>
        {#if !partnerOnline && data.partnerPresence?.lastSeenAt}
          <span class="last-seen faint">{timeAgo(data.partnerPresence.lastSeenAt)}</span>
        {/if}
      </div>
      <!-- Tunnel Talk invite button: only when partner is online and no session active -->
      {#if partnerOnline && !activeTunnel && data.convInfo.status === 'active'}
        <button
          class="btn btn-sm tunnel-btn"
          onclick={() => void inviteTunnel()}
          disabled={inviting}
          title="Invite to Tunnel Talk"
        >
          {inviting ? 'Inviting…' : '⚡ Tunnel Talk'}
        </button>
      {/if}
      <div class="lock-wrap">
        <button
          class="lock-btn lock-{encryptionLevel}"
          onclick={() => (showLockPopover = !showLockPopover)}
          aria-label="Encryption details"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z" clip-rule="evenodd" />
          </svg>
        </button>
        {#if showLockPopover}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="lock-backdrop" onclick={() => (showLockPopover = false)}></div>
          <div class="lock-popover panel">
            <p class="pop-title lock-{encryptionLevel}">{encryptionTitle[encryptionLevel]}</p>
            {#if encryptionLevel === 'e2ee' || encryptionLevel === 'e2ee-single'}
              <p class="pop-label">Messages available on:</p>
              <div class="device-section">
                <p class="pop-section-label">You</p>
                {#each data.myDeviceKeys as key (key.deviceId)}
                  <div class="device-row">
                    <span class="chk">✓</span>
                    {#if key.deviceId === deviceId}
                      <span class="device-id this-device">This device</span>
                    {:else}
                      <span class="device-id">{key.deviceId}</span>
                    {/if}
                  </div>
                {/each}
              </div>
              {#if data.partnerDeviceKeys.length > 0}
                <div class="device-section">
                  <p class="pop-section-label">@{data.username}</p>
                  {#each data.partnerDeviceKeys as key (key.deviceId)}
                    <div class="device-row">
                      <span class="chk">✓</span>
                      <span class="device-id">{key.deviceId}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            {:else}
              {#if encryptionLevel === 'server'}
                <p class="pop-detail">
                  {#if data.myDeviceKeys.length === 0 && data.partnerDeviceKeys.length === 0}
                    Neither party has registered device keys. Messages are encrypted in storage by Counter's servers, not on your device.
                  {:else if data.myDeviceKeys.length === 0}
                    You haven't registered a device key yet. Messages are encrypted in storage by Counter's servers, not on your device.
                  {:else}
                    @{data.username} hasn't registered a device key yet. Messages are encrypted in storage by Counter's servers, not on your device.
                  {/if}
                </p>
              {:else}
                <p class="pop-detail">{encryptionDetail[encryptionLevel]}</p>
              {/if}
            {/if}

            <hr class="pop-divider" />

            {#if confirmAction}
              <p class="pop-confirm-msg">
                {confirmAction === 'clear'
                  ? 'Delete all messages for both parties? The conversation stays.'
                  : 'Permanently delete this conversation for both parties?'}
              </p>
              <div class="pop-confirm-btns">
                <button class="btn btn-sm" onclick={() => (confirmAction = null)}>Cancel</button>
                <form method="POST" action={confirmAction === 'clear' ? '?/clear' : '?/deleteConversation'}>
                  <button class="btn btn-sm btn-danger" type="submit">
                    {confirmAction === 'clear' ? 'Clear' : 'Delete'}
                  </button>
                </form>
              </div>
            {:else}
              <div class="pop-actions">
                <button class="btn btn-sm btn-warn" onclick={() => (confirmAction = 'clear')}>Clear</button>
                <button class="btn btn-sm btn-danger" onclick={() => (confirmAction = 'delete')}>Delete</button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div class="thread">
    {#if data.messages.nextCursor}
      <a class="btn earlier" href="/messages/{data.username}?after={data.messages.nextCursor}">
        Load earlier messages
      </a>
    {/if}

    {#each chronological as msg (msg.id)}
      {#if msg.kind === 'tunnel_started'}
        <!-- Start marker for a Tunnel Talk session -->
        <div class="sys-notice tunnel-marker">
          <span class="sys-notice-inner faint">── Tunnel Talk Started ──</span>
        </div>
      {:else if msg.kind === 'tunnel_ended'}
        {@const sessionData = msg.tunnelSessionId
          ? (data.tunnelSessions as Record<string, TunnelSessionWithTranscript>)[msg.tunnelSessionId]
          : null}
        {@const wasDeclined = sessionData?.status === 'declined'}
        {@const hasTranscript = !wasDeclined && sessionData && sessionData.messages.length > 0}
        {#if wasDeclined && sessionData}
          <!-- Decline marker — no transcript, no asterisk -->
          <div class="sys-notice tunnel-marker">
            <span class="sys-notice-inner tunnel-declined">Tunnel Talk Declined by @{sessionData.participant.username}</span>
          </div>
        {:else}
          <!-- Inline transcript between the two markers, or asterisk when nothing saved -->
          {#if hasTranscript && sessionData}
            {#each sessionData.messages as tm (tm.id)}
              {@const tmMine = tm.sender.username !== data.username}
              <div class="bubble-row" class:mine={tmMine}>
                {#if !tmMine}
                  <Avatar user={tm.sender} size={28} />
                {/if}
                <div class="bubble panel" class:mine={tmMine}>
                  <p class="body">{tm.body}</p>
                  <span class="ts faint">{timeAgo(tm.sentAt)}</span>
                </div>
              </div>
            {/each}
          {:else}
            <div class="sys-notice tunnel-marker">
              <span class="sys-notice-inner faint">*</span>
            </div>
          {/if}
          <div class="sys-notice tunnel-marker">
            <span class="sys-notice-inner faint">── Tunnel Talk Ended ──</span>
          </div>
        {/if}
      {:else if msg.kind === 'screenshot' || msg.kind === 'cleared' || msg.kind === 'deleted'}
        {@const isOwn = msg.sender.username !== data.username}
        {@const eventLabel = msg.kind === 'screenshot'
          ? (isOwn ? 'You took a screenshot' : `@${msg.sender.username} took a screenshot`)
          : msg.kind === 'cleared'
            ? (isOwn ? 'You cleared the chat' : `@${msg.sender.username} cleared their history`)
            : (isOwn ? 'You deleted the conversation' : `@${msg.sender.username} deleted the conversation`)}
        <div class="sys-notice">
          <span class="sys-notice-inner faint">{eventLabel}</span>
        </div>
      {:else}
        {@const mine = msg.sender.username !== data.username}
        {@const previewUrls = extractAllUrls(displayBody(msg))}
        <div class="bubble-row" class:mine>
          {#if !mine}
            <Avatar user={msg.sender} size={28} />
          {/if}
          <div class="bubble panel" class:mine>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <p class="body">{@html linkifyMessageBody(displayBody(msg))}</p>
            {#each previewUrls as url (url)}
              <LinkPreview
                {url}
                apiUrl={API}
                accessToken={data.accessToken ?? null}
                compact={previewUrls.length > 1}
              />
            {/each}
            <span class="ts faint">{timeAgo(msg.createdAt)}</span>
          </div>
        </div>
      {/if}
    {:else}
      <p class="muted empty">No messages yet. Say something.</p>
    {/each}

    <!-- Partner's typing bubble. Ephemeral: driven only by the live socket, never persisted. -->
    {#if partnerTyping}
      <div class="bubble-row typing-row">
        <div class="bubble panel typing-bubble" aria-label="{data.username} is typing">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
        </div>
      </div>
    {/if}
  </div>

  <div class="compose-wrap">
    <!-- Pending incoming Tunnel Talk invite from the partner -->
    {#if pendingTunnel && !activeTunnel}
      <div class="tunnel-invite-banner panel">
        <span class="tunnel-invite-msg">@{data.username} invited you to Tunnel Talk</span>
        <div class="tunnel-invite-actions">
          <button
            class="btn btn-primary btn-sm"
            disabled={acceptingTunnel}
            onclick={() => void acceptTunnel(pendingTunnel!)}
          >
            {acceptingTunnel ? 'Joining…' : 'Join'}
          </button>
          <button
            class="btn btn-sm"
            onclick={() => void declineTunnel(pendingTunnel!)}
          >
            Decline
          </button>
        </div>
      </div>
    {/if}
    {#if isInboundRequest}
      <!-- Recipient view: accept or decline the request before replying. -->
      <div class="request-banner panel">
        <p class="request-msg">@{data.username} wants to send you a message.</p>
        <div class="request-actions">
          <form method="POST" action="?/accept">
            <button class="btn btn-primary btn-sm" type="submit">Accept</button>
          </form>
          <form method="POST" action="?/deleteConversation">
            <button class="btn btn-sm btn-danger" type="submit">Decline</button>
          </form>
        </div>
      </div>
    {:else if isRequest}
      <!-- Sender view: waiting for the recipient to accept. -->
      <p class="request-pending faint">
        Message request sent — waiting for @{data.username} to accept before you can send more.
      </p>
    {/if}
    {#if serverEncryptedFallback}
      <p class="server-enc-notice faint">
        🔒 Server-encrypted — not end-to-end. Messages are encrypted in storage but the server can read them. {data.partnerDeviceKeys.length === 0 ? `@${data.username} hasn't registered a device yet.` : 'Register your device to enable end-to-end encryption.'}
      </p>
    {:else if singleDeviceWarning}
      <p class="device-warn faint">
        🔒 Encrypted for this device only. Open Counter on your other devices to register them before sending, so they receive copies.
      </p>
    {/if}
    {#if !isRequest}
    {#if encryptError}
      <p class="error compose-error">{encryptError}</p>
    {:else if form?.error}
      <p class="error compose-error">{form.error}</p>
    {/if}
    <form
      method="POST"
      action="?/send"
      class="compose panel"
      use:enhance={async ({ formData, cancel }) => {
        const plaintext = textarea?.value ?? '';

        // Sending implies you've stopped typing; clear the partner's bubble now
        // rather than waiting for the idle timer.
        stopTyping();

        if (!plaintext.trim()) { cancel(); return; }

        if (plaintext.length > 10_000) {
          cancel();
          encryptError = 'Message is too long (max 10,000 characters).';
          return;
        }

        if (serverEncryptedFallback) {
          // No device keys on one side: send plaintext so the server can
          // encrypt it. The body field is left as-is (plaintext).
        } else {
          // Both sides have keys: encrypt client-side before the form posts.
          if (!privateKey || !deviceId || !currentPublicKey) {
            cancel();
            encryptError = 'Keys not loaded yet — please try again.';
            return;
          }

          // Always include the current device even if the server data hasn't
          // reflected the registration yet (e.g. first message after first load).
          const currentDevice: DeviceKey = { deviceId: deviceId!, publicKey: currentPublicKey! };
          const senderKeys: DeviceKey[] = [
            currentDevice,
            ...(data.myDeviceKeys as DeviceKey[]).filter(
              (k: DeviceKey) => k.deviceId !== deviceId,
            ),
          ];

          try {
            const encrypted = await encryptForDevices(
              plaintext,
              data.partnerDeviceKeys as DeviceKey[],
              senderKeys,
            );
            formData.set('body', encrypted);
          } catch {
            cancel();
            encryptError = 'Encryption failed — please try again.';
            return;
          }
        }

        // Inject the optimistic placeholder before the POST leaves the browser.
        // The textarea clears now so the user can start typing their next message
        // without waiting for the round-trip.
        const tempId = `opt-${crypto.randomUUID()}`;
        optimisticMessages = [
          ...optimisticMessages,
          {
            id: tempId,
            sender: data.user,
            body: plaintext,
            encrypted: false,
            read: true,
            kind: 'message',
            tunnelSessionId: null,
            createdAt: new Date().toISOString(),
          },
        ];
        if (textarea) textarea.value = '';

        sending = true;
        encryptError = null;
        return async ({ result, update }) => {
          sending = false;
          if (result.type === 'success') {
            const realMessage = (result.data as Record<string, unknown> | undefined)
              ?.message as DirectMessage | undefined;
            // Swap the placeholder for the confirmed message atomically.
            // Adding to liveMessages first means the dedup in onMessage will
            // silently drop the socket echo when it arrives.
            if (realMessage) liveMessages = [...liveMessages, realMessage];
            optimisticMessages = optimisticMessages.filter((m) => m.id !== tempId);
          } else {
            // Send failed: remove the placeholder and restore the textarea so the
            // user can retry without retyping.
            optimisticMessages = optimisticMessages.filter((m) => m.id !== tempId);
            if (textarea) textarea.value = plaintext;
            await update({ reset: false });
          }
        };
      }}
    >
      <textarea
        bind:this={textarea}
        name="body"
        placeholder="Write a message…"
        rows="2"
        maxlength="10000"
        oninput={handleTypingInput}
        onkeydown={handleKeydown}
        required
      ></textarea>
      <button class="btn btn-primary send" type="submit" disabled={sending}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </form>
    {/if}
  </div>
</div>

{#if activeTunnel && privateKey && deviceId}
  <TunnelTalk
    sessionId={activeTunnel.session.id}
    accessToken={data.accessToken ?? ''}
    partnerUsername={data.username}
    isInitiator={activeTunnel.isInitiator}
    {privateKey}
    myDeviceId={deviceId}
    partnerDeviceKeys={data.partnerDeviceKeys}
    myDeviceKeys={data.myDeviceKeys}
    onend={() => {
      activeTunnel = null;
      // Reload so the thread shows the Tunnel Talk end marker.
      void invalidateAll();
    }}
  />
{/if}

<style>
  /* Fixed-height flex column so the thread scrolls internally rather than
     the whole page growing with message count. */
  .chat {
    display: flex;
    flex-direction: column;
    height: calc(100dvh - 80px);
  }
  .head {
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--color-border);
    margin-bottom: var(--space-4);
    flex-shrink: 0;
  }
  .back {
    font-family: var(--mono);
    font-size: 0.82rem;
  }
  .head-right {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .request-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    margin-bottom: var(--space-2);
    flex-wrap: wrap;
  }
  .request-msg { margin: 0; font-size: 0.9rem; }
  .request-actions { display: flex; gap: var(--space-2); flex-shrink: 0; }
  .request-pending {
    font-size: 0.85rem;
    padding: var(--space-2) var(--space-3);
    text-align: center;
  }
  .partner-info {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
  }
  .partner-link {
    font-family: var(--mono);
    font-size: 0.88rem;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .online-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-repost);
    flex-shrink: 0;
    animation: pulse 2.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }
  .last-seen {
    font-family: var(--mono);
    font-size: 0.72rem;
  }

  /* Lock button */
  .lock-wrap {
    position: relative;
  }
  .lock-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    line-height: 1;
    border-radius: var(--radius);
    color: var(--color-text-dim);
    transition: color 0.15s, opacity 0.15s;
    display: flex;
    align-items: center;
  }
  .lock-btn svg {
    width: 14px;
    height: 14px;
  }
  .lock-btn:hover            { color: var(--color-text); }
  .lock-btn.lock-e2ee        { color: #4ade80; }
  .lock-btn.lock-e2ee-single { color: #4ade80; }
  .lock-btn.lock-server      { color: #fb923c; }

  /* Popover panel */
  .lock-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9;
  }
  .lock-popover {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 10;
    min-width: 240px;
    max-width: 320px;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .pop-title {
    margin: 0;
    font-family: var(--mono);
    font-size: 0.82rem;
    font-weight: 600;
  }
  .pop-title.lock-e2ee        { color: #4ade80; }
  .pop-title.lock-e2ee-single { color: #4ade80; }
  .pop-title.lock-server      { color: #fb923c; }
  .pop-title.lock-loading     { color: var(--color-text-dim); }
  .pop-label {
    margin: 0;
    font-size: 0.75rem;
    color: var(--color-text-dim);
    font-family: var(--mono);
  }
  .pop-detail {
    margin: 0;
    font-size: 0.82rem;
    color: var(--color-text-dim);
    line-height: 1.5;
  }
  .device-section {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .pop-section-label {
    margin: 0 0 2px;
    font-size: 0.72rem;
    font-family: var(--mono);
    font-weight: 600;
    color: var(--color-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .device-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .chk {
    color: #4ade80;
    font-size: 0.8rem;
    flex-shrink: 0;
  }
  .device-id {
    font-family: var(--mono);
    font-size: 0.72rem;
    color: var(--color-text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .device-id.this-device {
    color: var(--color-text);
    font-weight: 500;
  }
  .pop-divider {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: var(--space-2) 0 0;
  }
  .pop-actions {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3);
  }
  .pop-confirm-msg {
    margin: var(--space-2) var(--space-3) var(--space-2);
    font-size: 0.8rem;
    color: var(--color-text-dim);
    line-height: 1.4;
  }
  .pop-confirm-btns {
    display: flex;
    gap: var(--space-2);
    padding: 0 var(--space-3) var(--space-3);
  }
  .btn-sm {
    padding: 3px 10px;
    font-size: 0.78rem;
  }
  .btn-warn {
    border-color: #fb923c;
    color: #fb923c;
  }
  .btn-warn:hover {
    background: color-mix(in srgb, #fb923c 12%, transparent);
  }
  .btn-danger {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }
  .btn-danger:hover {
    background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  }
  /* Thread grows to fill whatever space is left between the header and compose. */
  .thread {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-bottom: var(--space-4);
    overflow-y: auto;
  }
  .earlier {
    display: block;
    margin: 0 auto var(--space-2);
    width: fit-content;
  }
  .bubble-row {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .bubble-row.mine {
    flex-direction: row-reverse;
  }
  .bubble {
    max-width: 72%;
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  /* Accent tint on sent messages so the two sides read apart at a glance. */
  .bubble.mine {
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface));
    border-color: color-mix(in srgb, var(--color-accent) 30%, var(--color-border));
  }
  .body {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.92rem;
    line-height: 1.5;
  }
  /* URLs rendered via {@html linkifyMessageBody} sit outside Svelte's scope. */
  .bubble :global(.msg-link) {
    color: var(--color-accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .bubble :global(.msg-link):hover {
    opacity: 0.75;
  }
  .ts {
    font-family: var(--mono);
    font-size: 0.7rem;
    align-self: flex-end;
  }
  /* Typing bubble: three dots that fade in sequence. Left-aligned like a
     partner message, but with no avatar so it reads as transient. */
  .typing-bubble {
    flex-direction: row;
    align-items: center;
    gap: 5px;
    padding: var(--space-2) var(--space-3);
  }
  .typing-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-text-dim);
    animation: typing-blink 1.4s ease-in-out infinite;
  }
  .typing-dot:nth-child(2) { animation-delay: 0.2s; }
  .typing-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes typing-blink {
    0%, 60%, 100% { opacity: 0.25; }
    30%           { opacity: 1; }
  }
  .sys-notice {
    display: flex;
    justify-content: center;
    padding: var(--space-1) 0;
  }
  .sys-notice-inner {
    font-family: var(--mono);
    font-size: 0.75rem;
    padding: 3px var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 999px;
  }
  .sys-notice-inner.tunnel-declined {
    background: #450a0a;
    border-color: #7f1d1d;
    color: #f87171;
  }
  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-dim);
  }
  /* Compose bar is pinned to the bottom of the flex column, not the viewport,
     so it stays at the end of the content rather than floating over it. */
  .compose-wrap {
    flex-shrink: 0;
    position: sticky;
    bottom: 0;
    background: var(--color-bg);
    padding-top: var(--space-2);
  }
  .device-warn {
    font-size: 0.82rem;
    margin: 0 0 var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }
  .compose-error {
    margin: 0 0 var(--space-2);
  }
  .server-enc-notice {
    font-size: 0.82rem;
    margin: 0 0 var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }
  .compose {
    display: flex;
    gap: var(--space-2);
    align-items: flex-end;
    padding: var(--space-3);
  }
  .compose textarea {
    flex: 1;
    min-height: 44px;
    max-height: 160px;
    resize: none;
  }
  .send {
    flex-shrink: 0;
    align-self: flex-end;
  }

  /* Tunnel Talk invite button in the conversation header */
  .tunnel-btn {
    font-size: 0.78rem;
    opacity: 0.85;
  }
  .tunnel-btn:hover { opacity: 1; }

  /* Centered system marker for tunnel_started / tunnel_ended / asterisk */
  .tunnel-marker {
    margin: var(--space-1) 0;
  }

  /* Pending Tunnel Talk invite banner */
  .tunnel-invite-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    margin-bottom: var(--space-2);
    flex-wrap: wrap;
    border-left: 3px solid var(--color-accent, #6366f1);
  }
  .tunnel-invite-msg {
    font-size: 0.9rem;
  }
  .tunnel-invite-actions {
    display: flex;
    gap: var(--space-2);
    flex-shrink: 0;
  }
</style>
