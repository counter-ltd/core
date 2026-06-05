<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The messages inbox: all conversations sorted by most recent activity.
   * Unread conversations are highlighted with an accent border, matching the
   * pattern used on the notifications page.
   */
  import Avatar from '$lib/components/Avatar.svelte';
  import { timeAgo } from '$lib/format';

  let { data } = $props();

  // Truncate the preview body so it fits on one line regardless of message length.
  function preview(body: string, max = 80): string {
    return body.length > max ? body.slice(0, max) + '…' : body;
  }
</script>

<svelte:head><title>Messages · Counter</title></svelte:head>

<h1 class="title">Messages</h1>

<div class="stack">
  {#each data.conversations.data as conv (conv.id)}
    <a
      class="row panel convo"
      class:unread={conv.unreadCount > 0}
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
          </span>
          <span class="time faint">{timeAgo(conv.lastMessageAt)}</span>
        </div>
        {#if conv.lastMessage}
          <span class="preview muted">
            {#if conv.lastMessage.encrypted}
              <!-- E2EE ciphertexts (v2:/v3: prefix) can't be previewed
                   server-side. Server-encrypted messages are decrypted by the
                   server before reaching the client, so encrypted:true is
                   always E2EE — hence the green glyph. -->
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

{#if data.conversations.nextCursor}
  <a class="btn more" href="/messages?after={data.conversations.nextCursor}">Load more</a>
{/if}

<style>
  .title { margin-bottom: var(--space-4); }
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
</style>
