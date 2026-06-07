<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The public square, aka the home page. This is the algorithm-ranked public feed
   * that anyone can read without logging in. The composer only appears for
   * signed-in users; everyone else just reads.
   */
  import PostCard from '$lib/components/PostCard.svelte';
  import Composer from '$lib/components/Composer.svelte';
  let { data } = $props();
</script>

<svelte:head><title>Counter</title></svelte:head>

<header class="hero panel">
  <span class="kicker">public timeline</span>
  <h1>Everything here is readable.</h1>
  <p class="muted">
    Every post and profile is public, no login required. The feed is ordered by
    <a href="/about/algorithm">weights you can read</a>, and a view is an anonymous tick — never tied
    to you.
  </p>
</header>

<!-- Only logged-in people can post; the redirect brings them back here after -->
{#if data.user}
  {#await data.topics then topics}
    <Composer redirectTo="/" placeholder="Say something public…" {topics} />
  {/await}
{/if}

<div class="stack feed">
  {#await data.feed}
    <p class="muted">Loading…</p>
  {:then feed}
    {#each feed.data as post (post.id)}
      <PostCard {post} currentUser={data.user} redirectTo="/" />
    {:else}
      <p class="muted empty">No posts yet. Be the first.</p>
    {/each}
    <!-- Cursor pagination: a link rather than a button so it works without JS
         and keeps the URL shareable. nextCursor is absent on the last page. -->
    {#if feed.nextCursor}
      <a class="btn more" href="/?after={feed.nextCursor}">Load more</a>
    {/if}
  {/await}
</div>

<style>
  .hero {
    padding: var(--space-5);
    margin-bottom: var(--space-4);
  }
  .kicker {
    display: block;
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.68rem;
    color: var(--color-accent);
    margin-bottom: var(--space-2);
  }
  .hero h1 {
    font-size: 1.5rem;
  }
  .hero p {
    margin: 0;
    max-width: 48ch;
  }
  .feed {
    margin-top: var(--space-4);
  }
  .empty {
    padding: var(--space-6);
    text-align: center;
  }
  .more {
    margin: var(--space-4) auto 0;
    display: inline-flex;
  }
</style>
