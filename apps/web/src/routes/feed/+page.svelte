<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The signed-in user's following feed: posts from accounts they follow, newest
   * first. Unlike the public square, this one is plain reverse-chronological with
   * no ranking, and it's a logged-in-only route (the load guards access).
   */
  import PostCard from '$lib/components/PostCard.svelte';
  import Composer from '$lib/components/Composer.svelte';
  let { data } = $props();
</script>

<svelte:head><title>Your feed · Counter</title></svelte:head>

<h1 class="title">Your feed</h1>
<p class="muted sub">Posts from people you follow, newest first.</p>

{#await data.topics}
  <Composer redirectTo="/feed" topics={[]} />
{:then topics}
  <Composer redirectTo="/feed" {topics} />
{/await}

<div class="stack feed">
  {#await data.feed}
    <p class="muted">Loading…</p>
  {:then feed}
    {#each feed.data as post (post.id)}
      <PostCard {post} currentUser={data.user} redirectTo="/feed" />
    {:else}
      <p class="muted empty">Your feed is quiet. Follow some people, or check the <a href="/">public square</a>.</p>
    {/each}
    {#if feed.nextCursor}
      <a class="btn more" href="/feed?after={feed.nextCursor}">Load more</a>
    {/if}
  {/await}
</div>

<style>
  .title { margin-bottom: 0; }
  .sub { margin-top: 0; margin-bottom: var(--space-4); }
  .feed { margin-top: var(--space-4); }
  .empty { padding: var(--space-6); text-align: center; }
  .more { margin: var(--space-4) auto 0; display: inline-flex; }
</style>
