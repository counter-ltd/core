<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * A single post shown in thread context: its ancestors above (the chain that
   * led to it), the focused post itself, the reply composer, then its direct
   * replies below. The load groups all three into `data.thread`.
   */
  import PostCard from '$lib/components/PostCard.svelte';
  import Composer from '$lib/components/Composer.svelte';
  let { data } = $props();

  const t = $derived(data.thread);
  // Canonical URL of the focused post, used as the redirect target for every
  // like/repost/reply on this page so actions land back here.
  const here = $derived(`/${t.post.author.username}/post/${t.post.id}`);
</script>

<svelte:head>
  <title>{t.post.author.displayName || t.post.author.username} on Counter</title>
</svelte:head>

<!-- The reply chain leading up to this post, oldest first, so the thread reads
     top to bottom. The trailing line visually connects it to the focused post. -->
{#if t.ancestors.length}
  <div class="stack ancestors">
    {#each t.ancestors as a (a.id)}
      <PostCard post={a} currentUser={data.user} redirectTo={here} />
    {/each}
    <div class="thread-line" aria-hidden="true"></div>
  </div>
{/if}

<div class="focus">
  <PostCard post={t.post} currentUser={data.user} redirectTo={here} />
</div>

<!-- Reply box for members; guests get a nudge to log in instead -->
{#if data.user}
  <div class="reply">
    <Composer parentId={t.post.id} redirectTo={here} placeholder="Post your reply…" cta="Reply" />
  </div>
{:else}
  <p class="muted login-hint panel"><a href="/login">Log in</a> to reply.</p>
{/if}

<h2 class="rtitle">{t.replies.length ? 'Replies' : 'No replies yet'}</h2>
<div class="stack">
  {#each t.replies as r (r.id)}
    <PostCard post={r} currentUser={data.user} redirectTo={here} />
  {/each}
</div>

<style>
  .ancestors {
    margin-bottom: var(--space-3);
    opacity: 0.85;
  }
  .thread-line {
    width: 2px;
    height: var(--space-4);
    margin-left: 38px;
    background: var(--color-border-bright);
  }
  /* Reach into the PostCard's own markup to brighten the focused post's border,
     so it stands out from its ancestors and replies. */
  .focus :global(.post) {
    border-color: var(--color-border-bright);
  }
  .reply {
    margin: var(--space-4) 0;
  }
  .login-hint {
    padding: var(--space-4);
    margin: var(--space-4) 0;
    text-align: center;
  }
  .rtitle {
    font-size: 1.05rem;
    margin: var(--space-5) 0 var(--space-3);
    color: var(--color-text-dim);
  }
</style>
