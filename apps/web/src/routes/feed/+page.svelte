<script lang="ts">
  import PostCard from '$lib/components/PostCard.svelte';
  import Composer from '$lib/components/Composer.svelte';
  let { data } = $props();
</script>

<svelte:head><title>Your feed · Counter</title></svelte:head>

<h1 class="title">Your feed</h1>
<p class="muted sub">Posts from people you follow, newest first.</p>

<Composer redirectTo="/feed" />

<div class="stack feed">
  {#each data.feed.data as post (post.id)}
    <PostCard {post} currentUser={data.user} redirectTo="/feed" />
  {:else}
    <p class="muted empty">Your feed is quiet. Follow some people, or check the <a href="/">public square</a>.</p>
  {/each}
</div>

{#if data.feed.nextCursor}
  <a class="btn more" href="/feed?after={data.feed.nextCursor}">Load more</a>
{/if}

<style>
  .title { margin-bottom: 0; }
  .sub { margin-top: 0; margin-bottom: var(--space-4); }
  .feed { margin-top: var(--space-4); }
  .empty { padding: var(--space-6); text-align: center; }
  .more { margin: var(--space-4) auto 0; display: inline-flex; }
</style>
