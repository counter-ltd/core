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
    redirectTo = '/feed',
    placeholder = "What's happening?",
    cta = 'Post',
  }: { parentId?: string | null; topicId?: string | null; redirectTo?: string; placeholder?: string; cta?: string } =
    $props();

  // Bound to the textarea so we can show the count and gate the button. The
  // server is still the source of truth on length; this is just feedback.
  let value = $state('');
</script>

<form method="POST" action="/actions/compose" class="composer panel">
  <!-- Only emit these when set so the action doesn't see empty parent/topic. -->
  {#if parentId}<input type="hidden" name="parentId" value={parentId} />{/if}
  {#if topicId}<input type="hidden" name="topicId" value={topicId} />{/if}
  <input type="hidden" name="redirectTo" value={redirectTo} />
  <textarea
    name="body"
    {placeholder}
    maxlength={POST.MAX_BODY_LENGTH}
    bind:value
    required
  ></textarea>
  <div class="bar">
    <span class="faint count">{value.length}/{POST.MAX_BODY_LENGTH}</span>
    <button class="btn btn-primary" type="submit" disabled={value.trim().length === 0}>{cta}</button>
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
    margin-top: var(--space-3);
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-3);
  }
  .count {
    font-size: 0.8rem;
  }
</style>
