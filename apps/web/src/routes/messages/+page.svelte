<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The messages inbox: active conversations plus a Requests tab for inbound
   * message requests. Sent requests appear in the main list with a "pending"
   * label until the recipient accepts.
   *
   * The compose button (pencil icon) opens a modal dialog where the user can
   * search for anyone to start a new conversation without visiting their profile.
   */
  import Avatar from '$lib/components/Avatar.svelte';
  import { timeAgo } from '$lib/format';
  import { goto } from '$app/navigation';
  import type { PublicUser } from '@counter/types';

  let { data } = $props();

  let tab = $state<'messages' | 'requests'>('messages');

  // New-message dialog
  let dialog = $state<HTMLDialogElement | undefined>(undefined);
  let query = $state('');
  let searchResults = $state<PublicUser[]>([]);
  let isSearching = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function openNewMessage() {
    query = '';
    searchResults = [];
    dialog?.showModal();
  }

  function closeNewMessage() {
    dialog?.close();
  }

  // Close when the user clicks the backdrop (the click target is the <dialog> itself).
  function onDialogClick(e: MouseEvent) {
    if (e.target === dialog) closeNewMessage();
  }

  function onQueryInput() {
    clearTimeout(debounceTimer);
    const q = query.trim();
    if (!q) { searchResults = []; return; }
    debounceTimer = setTimeout(() => void runSearch(q), 350);
  }

  async function runSearch(q: string) {
    isSearching = true;
    try {
      const res = await fetch(`/messages/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const page = await res.json() as { data: PublicUser[] };
        searchResults = page.data;
      }
    } finally {
      isSearching = false;
    }
  }

  function selectUser(username: string) {
    closeNewMessage();
    goto(`/messages/${username}`);
  }

  // Truncate the preview body so it fits on one line regardless of message length.
  function preview(body: string, max = 80): string {
    return body.length > max ? body.slice(0, max) + '…' : body;
  }
</script>

<svelte:head><title>Messages · Counter</title></svelte:head>

<div class="title-row">
  <h1 class="title">Messages</h1>
  <button class="compose-btn" onclick={openNewMessage} aria-label="New message" title="New message">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  </button>
</div>

<div class="tabs" role="tablist">
  <button
    class="tab"
    class:active={tab === 'messages'}
    role="tab"
    aria-selected={tab === 'messages'}
    onclick={() => (tab = 'messages')}
  >Messages</button>
  <button
    class="tab"
    class:active={tab === 'requests'}
    role="tab"
    aria-selected={tab === 'requests'}
    onclick={() => (tab = 'requests')}
  >
    Requests
    {#await data.inbox then inbox}
      {#if inbox.requests.data.length > 0}
        <span class="tab-badge">{inbox.requests.data.length}</span>
      {/if}
    {/await}
  </button>
</div>

{#await data.inbox}
  <div class="stack"><p class="muted empty">Loading…</p></div>
{:then inbox}
  {#if tab === 'messages'}
    <div class="stack">
      {#each inbox.conversations.data as conv (conv.id)}
        <a
          class="row panel convo"
          class:unread={conv.unreadCount > 0}
          class:pending={conv.status === 'request'}
          href="/messages/{conv.partner.username}"
        >
          <Avatar user={conv.partner} size={42} />
          <div class="info">
            <div class="spread name-row">
              <span class="name">
                <strong>{conv.partner.displayName || conv.partner.username}</strong>
                <span class="handle faint">@{conv.partner.username}</span>
                {#if conv.partner.presence?.isOnline}
                  <span class="online-dot" title="Online now" aria-label="Online"></span>
                {/if}
                {#if conv.status === 'request'}
                  <span class="pending-label">pending</span>
                {/if}
              </span>
              <span class="time faint">{timeAgo(conv.lastMessageAt)}</span>
            </div>
            {#if conv.lastMessage}
              <span class="preview muted">
                {#if conv.lastMessage.encrypted}
                  <!-- E2EE ciphertexts (v2:/v3: prefix) can't be previewed
                       server-side. Server-encrypted messages are decrypted by
                       the server before reaching the client, so encrypted:true
                       is always E2EE — hence the green glyph. -->
                  <span class="lock-preview">
                    <svg class="lock-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path fill-rule="evenodd" d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z" clip-rule="evenodd" />
                    </svg>
                    Encrypted message
                  </span>
                {:else if conv.lastMessage.sender.id === conv.partner.id}
                  {preview(conv.lastMessage.body)}
                {:else}
                  <span class="you faint">You: </span>{preview(conv.lastMessage.body)}
                {/if}
              </span>
            {/if}
          </div>
          {#if conv.unreadCount > 0}
            <span class="badge">{conv.unreadCount}</span>
          {/if}
        </a>
      {:else}
        <p class="muted empty">No conversations yet. Visit someone's profile to send them a message.</p>
      {/each}
    </div>
    {#if inbox.conversations.nextCursor}
      <a class="btn more" href="/messages?after={inbox.conversations.nextCursor}">Load more</a>
    {/if}
  {:else}
    <div class="stack">
      {#each inbox.requests.data as conv (conv.id)}
        <a class="row panel convo" href="/messages/{conv.partner.username}">
          <Avatar user={conv.partner} size={42} />
          <div class="info">
            <div class="spread name-row">
              <span class="name">
                <strong>{conv.partner.displayName || conv.partner.username}</strong>
                <span class="handle faint">@{conv.partner.username}</span>
              </span>
              <span class="time faint">{timeAgo(conv.lastMessageAt)}</span>
            </div>
            {#if conv.lastMessage}
              <span class="preview muted">
                {#if conv.lastMessage.encrypted}
                  <span class="lock-preview">
                    <svg class="lock-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path fill-rule="evenodd" d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z" clip-rule="evenodd" />
                    </svg>
                    Encrypted message
                  </span>
                {:else}
                  {preview(conv.lastMessage.body)}
                {/if}
              </span>
            {/if}
          </div>
        </a>
      {:else}
        <p class="muted empty">No message requests.</p>
      {/each}
    </div>
  {/if}
{/await}

<!-- New-message dialog. Uses the native <dialog> element so focus trapping,
     backdrop clicks, and Escape-to-close all work without extra JS. -->
<dialog
  bind:this={dialog}
  class="new-message-dialog"
  onclick={onDialogClick}
>
  <div class="dialog-inner">
    <div class="dialog-header">
      <h2 class="dialog-title">New message</h2>
      <button class="close-btn" onclick={closeNewMessage} aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="search-wrap">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input
        class="search-input"
        type="search"
        placeholder="Search users…"
        bind:value={query}
        oninput={onQueryInput}
        autofocus
        autocomplete="off"
        spellcheck="false"
      />
    </div>

    <div class="dialog-results">
      {#if isSearching}
        <p class="dialog-hint muted">Searching…</p>
      {:else if query.trim() && searchResults.length === 0}
        <p class="dialog-hint muted">No users found for "{query.trim()}"</p>
      {:else if !query.trim()}
        <p class="dialog-hint muted">Search for someone to message</p>
      {:else}
        {#each searchResults as user (user.id)}
          <button class="user-result" onclick={() => selectUser(user.username)}>
            <Avatar {user} size={38} />
            <div class="user-info">
              <span class="user-name">{user.displayName || user.username}</span>
              <span class="user-handle faint">@{user.username}</span>
            </div>
          </button>
        {/each}
      {/if}
    </div>
  </div>
</dialog>

<style>
  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-3);
  }
  .title { margin: 0; }

  .compose-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    background: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s;
    flex-shrink: 0;
  }
  .compose-btn:hover {
    color: var(--color-text);
    border-color: var(--color-border-bright);
  }
  .compose-btn svg { width: 16px; height: 16px; }

  .tabs {
    display: flex;
    gap: 2px;
    margin-bottom: var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }
  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: var(--space-2) var(--space-3);
    margin-bottom: -1px;
    cursor: pointer;
    color: var(--color-text-muted);
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    transition: color 0.12s, border-color 0.12s;
  }
  .tab:hover { color: var(--color-text); }
  .tab.active { color: var(--color-text); border-bottom-color: var(--color-accent); }
  .tab-badge {
    background: var(--color-accent);
    color: var(--color-accent-contrast);
    font-family: var(--mono);
    font-size: 0.7rem;
    font-weight: 600;
    border-radius: var(--radius-pill);
    min-width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 5px;
  }

  .pending-label {
    font-family: var(--mono);
    font-size: 0.7rem;
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-pill);
    padding: 1px 6px;
  }

  .convo {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    transition: border-color 0.12s;
  }
  .convo:hover { border-color: var(--color-border-bright); }
  .convo.unread { border-color: var(--color-accent); }
  .info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    gap: 2px;
  }
  .name-row { align-items: baseline; }
  .name {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }
  .name strong { font-weight: 500; white-space: nowrap; }
  .handle { font-family: var(--mono); font-size: 0.78rem; white-space: nowrap; }
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
  .preview {
    font-size: 0.88rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .you { font-family: var(--mono); font-size: 0.82rem; }
  .time { font-family: var(--mono); font-size: 0.78rem; white-space: nowrap; }
  .badge {
    flex-shrink: 0;
    background: var(--color-accent);
    color: var(--color-accent-contrast);
    font-family: var(--mono);
    font-size: 0.72rem;
    font-weight: 600;
    border-radius: var(--radius-pill);
    min-width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 6px;
  }
  .lock-preview {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #4ade80;
  }
  .lock-glyph {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
  }
  .empty { padding: var(--space-6); text-align: center; }
  .more { margin: var(--space-4) auto 0; display: inline-flex; }

  /* Dialog */

  .new-message-dialog {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: 0;
    width: min(480px, 92vw);
    max-height: 70vh;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    /* The ::backdrop pseudo-element handles the dimmed overlay. */
  }
  .new-message-dialog::backdrop {
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px);
  }
  .dialog-inner {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-4) var(--space-3);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }
  .dialog-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }
  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    cursor: pointer;
    transition: color 0.12s;
  }
  .close-btn:hover { color: var(--color-text); }
  .close-btn svg { width: 15px; height: 15px; }

  .search-wrap {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }
  .search-icon {
    width: 16px;
    height: 16px;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }
  .search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 0.95rem;
    color: var(--color-text);
    /* Remove the browser's built-in search cancel button. */
  }
  .search-input::-webkit-search-cancel-button { display: none; }

  .dialog-results {
    overflow-y: auto;
    flex: 1;
    padding: var(--space-2) 0;
  }
  .dialog-hint {
    padding: var(--space-4);
    text-align: center;
    font-size: 0.9rem;
  }

  .user-result {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-4);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--color-text);
    transition: background 0.1s;
  }
  .user-result:hover { background: var(--color-surface-raised); }
  .user-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .user-name { font-size: 0.92rem; font-weight: 500; }
  .user-handle { font-family: var(--mono); font-size: 0.78rem; }
</style>
