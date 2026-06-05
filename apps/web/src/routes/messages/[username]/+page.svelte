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
  import { timeAgo } from '$lib/format';
  import {
    loadOrGenerateKeyPair,
    exportPublicKey,
    encryptForDevices,
    decryptMessage,
  } from '$lib/e2ee';
  import type { ActionData } from './$types';
  import type { DeviceKey, DirectMessage } from '@counter/types';

  let { data, form }: { data: any; form: ActionData } = $props();

  // Reverse so the thread reads top-to-bottom chronologically.
  const chronological = $derived([...data.messages.data].reverse());

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
        // Reload page data so myDeviceKeys and partnerDeviceKeys are current.
        // This is what flips the server-encrypted notice off once both sides
        // have registered.
        await invalidateAll();
      } catch {
        // Registration failed; will retry on next page load.
      }
    }
  });

  // Re-runs whenever the key or message list changes (e.g. after a send-redirect
  // refreshes page data without remounting the component). Decrypts all encrypted
  // messages: with v3 format, the sender's copies are included, so both sides are
  // readable on every registered device.
  $effect(() => {
    const pk = privateKey;
    const did = deviceId;
    const msgs = data.messages.data as DirectMessage[];
    if (!pk || !did) return;

    void (async () => {
      const map = new Map<string, string>();
      for (const msg of msgs) {
        if (msg.encrypted) {
          try {
            map.set(msg.id, await decryptMessage(msg.body, pk, did));
          } catch {
            map.set(msg.id, '[Encrypted with a previous key]');
          }
        }
      }
      decryptedBodies = map;
    })();
  });

  function displayBody(msg: DirectMessage): string {
    if (!msg.encrypted) return msg.body;
    return decryptedBodies.get(msg.id) ?? '🔒 Decrypting…';
  }

  // Server-encrypted fallback: at least one party has no registered device
  // keys, so messages are AES-encrypted by the server rather than on-device.
  // Both users see a notice; the compose box stays open.
  const serverEncryptedFallback = $derived(
    data.partnerDeviceKeys.length === 0 || data.myDeviceKeys.length === 0,
  );

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
</script>

<svelte:head><title>@{data.username} · Messages · Counter</title></svelte:head>

<div class="chat">
  <div class="head spread">
    <a href="/messages" class="back faint">← Messages</a>
    <div class="head-right">
      <div class="partner-info">
        <a href="/{data.username}" class="partner-link">
          @{data.username}
          {#if data.partnerPresence?.isOnline}
            <span class="online-dot" title="Online now" aria-label="Online"></span>
          {/if}
        </a>
        {#if !data.partnerPresence?.isOnline && data.partnerPresence?.lastSeenAt}
          <span class="last-seen faint">{timeAgo(data.partnerPresence.lastSeenAt)}</span>
        {/if}
      </div>
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
              <p class="pop-detail">{encryptionDetail[encryptionLevel]}</p>
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
      {#if msg.kind === 'screenshot' || msg.kind === 'cleared' || msg.kind === 'deleted'}
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
        <div class="bubble-row" class:mine>
          {#if !mine}
            <Avatar user={msg.sender} size={28} />
          {/if}
          <div class="bubble panel" class:mine>
            <p class="body">{displayBody(msg)}</p>
            <span class="ts faint">{timeAgo(msg.createdAt)}</span>
          </div>
        </div>
      {/if}
    {:else}
      <p class="muted empty">No messages yet. Say something.</p>
    {/each}
  </div>

  <div class="compose-wrap">
    {#if serverEncryptedFallback}
      <p class="server-enc-notice faint">
        🔒 Server-encrypted — not end-to-end. Messages are encrypted in storage but the server can read them. {data.partnerDeviceKeys.length === 0 ? `@${data.username} hasn't registered a device yet.` : 'Register your device to enable end-to-end encryption.'}
      </p>
    {:else if singleDeviceWarning}
      <p class="device-warn faint">
        🔒 Encrypted for this device only. Open Counter on your other devices to register them before sending, so they receive copies.
      </p>
    {/if}
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

        sending = true;
        encryptError = null;
        return async ({ update }) => {
          sending = false;
          await update({ reset: false });
          if (!form?.error && textarea) textarea.value = '';
        };
      }}
    >
      <textarea
        bind:this={textarea}
        name="body"
        placeholder="Write a message…"
        rows="2"
        maxlength="10000"
        required
      ></textarea>
      <button class="btn btn-primary send" type="submit" disabled={sending}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </form>
  </div>
</div>

<style>
  /* Full-height flex column so the thread fills the space and the compose bar
     pins to the bottom regardless of how many messages are showing. */
  .chat {
    display: flex;
    flex-direction: column;
    min-height: calc(100vh - 120px);
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
  .ts {
    font-family: var(--mono);
    font-size: 0.7rem;
    align-self: flex-end;
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
</style>
