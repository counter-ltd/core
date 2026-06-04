<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The box you type a post into. It's a plain form that POSTs to the compose
   * action, so it works without JS; the only client-side touch is the live
   * character count and disabling submit while empty.
   *
   * Props:
   *   parentId     Set when this is a reply, so the server threads it under that
   *                post. Null for a top-level post.
   *   topicId      Set when posting into a specific topic. Null otherwise.
   *   redirectTo   Where the server sends you back to after posting. Defaults to
   *                the feed; reply forms pass the thread they live on so you
   *                land back where you were.
   *   placeholder  Prompt text in the empty textarea.
   *   cta          Label on the submit button ("Post", "Reply", etc).
   */
  import { POST } from '@counter/config';

  let {
    parentId = null,
    topicId = null,
    topics = null,
    redirectTo = '/feed',
    placeholder = "What's happening?",
    cta = 'Post',
  }: {
    parentId?: string | null;
    topicId?: string | null;
    /** When provided, shows a topic selector in the bar. */
    topics?: Array<{ id: string; slug: string; name: string }> | null;
    redirectTo?: string;
    placeholder?: string;
    cta?: string;
  } = $props();

  let value = $state('');
  // Track selected topic separately so the hidden input reflects the select.
  let selectedTopicId = $state(topicId ?? '');
</script>

<form method="POST" action="/actions/compose" class="composer panel">
  {#if parentId}<input type="hidden" name="parentId" value={parentId} />{/if}
  <!-- When a selector is shown the <select> provides the topicId value directly.
       When the topic is pre-scoped (topic page), use a hidden input instead. -->
  {#if !topics && topicId}
    <input type="hidden" name="topicId" value={topicId} />
  {/if}
  <input type="hidden" name="redirectTo" value={redirectTo} />
  <textarea
    name="body"
    {placeholder}
    maxlength={POST.MAX_BODY_LENGTH}
    bind:value
    required
  ></textarea>
  <div class="bar">
    {#if topics && topics.length > 0}
      <select
        name="topicId"
        class="topic-select"
        bind:value={selectedTopicId}
      >
        <option value="">No topic</option>
        {#each topics as t (t.id)}
          <option value={t.id}>{t.name}</option>
        {/each}
      </select>
    {:else}
      <span class="faint count">{value.length}/{POST.MAX_BODY_LENGTH}</span>
    {/if}
    <div class="right">
      {#if topics && topics.length > 0}
        <span class="faint count">{value.length}/{POST.MAX_BODY_LENGTH}</span>
      {/if}
      <button class="btn btn-primary" type="submit" disabled={value.trim().length === 0}>{cta}</button>
    </div>
  </div>
</form>

<style>
  .composer {
    padding: var(--space-4);
  }
  textarea {
    background: transparent;
    border: none;
    padding: 0;
    min-height: 70px;
  }
  textarea:focus {
    outline: none;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-top: var(--space-3);
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-3);
  }
  .right {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-left: auto;
  }
  .topic-select {
    font-family: var(--mono);
    font-size: 0.8rem;
    background: var(--color-surface-strong, var(--color-bg-2));
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 3px 6px;
    color: var(--color-text);
    max-width: 160px;
  }
  .count {
    font-size: 0.8rem;
  }
</style>
