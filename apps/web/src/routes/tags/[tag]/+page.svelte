<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * A hashtag's page: a header showing the tag and the feed of every post
   * carrying it. No composer or join button, since a tag isn't a space you
   * belong to, just a label posts share.
   */
  import PostCard from '$lib/components/PostCard.svelte';

  let { data } = $props();

  const tag = $derived(data.tag);
  // Pagination links return to this same tag feed.
  const here = $derived(`/tags/${tag}`);
</script>

<svelte:head><title>#{tag} · Counter</title></svelte:head>

<header class="tag-header panel">
  <h1 class="name">#{tag}</h1>
  <span class="path faint">/tags/{tag}</span>
</header>

<div class="stack feed">
  {#each data.feed.data as post (post.id)}
    <PostCard {post} currentUser={data.user} redirectTo={here} />
  {:else}
    <p class="muted empty">No posts tagged #{tag} yet.</p>
  {/each}
</div>

{#if data.feed.nextCursor}
  <a class="btn more" href="{here}?after={data.feed.nextCursor}">Load more</a>
{/if}

<style>
  .tag-header {
    padding: var(--space-5);
    margin-bottom: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .name { margin: 0; }
  .path {
    font-family: var(--mono);
    font-size: 0.8rem;
  }
  .feed { margin-top: var(--space-4); }
  .empty { padding: var(--space-6); text-align: center; }
  .more { margin: var(--space-4) auto 0; display: inline-flex; }
</style>
