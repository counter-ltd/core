<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * A single topic's page: its header (name, description, counts, join button)
   * and the feed of posts in that topic. Members get a composer pre-scoped to
   * this topic so anything they write here posts into it.
   */
  import PostCard from '$lib/components/PostCard.svelte';
  import Composer from '$lib/components/Composer.svelte';
  import { compact } from '$lib/format';

  let { data } = $props();

  const t = $derived(data.topic);
  // Topic URL, reused as the redirect target for the composer, join button, and
  // pagination so every action returns to this topic.
  const here = $derived(`/topics/${t.slug}`);
  // Default to non-member for logged-out viewers, who have no `viewer` block.
  const isMember = $derived(t.viewer?.isMember ?? false);
</script>

<svelte:head><title>{t.name} · Topics · Counter</title></svelte:head>

<header class="topic-header panel">
  <div class="top">
    <div class="meta">
      <a href="/topics" class="back faint">/topics</a>
      <h1 class="name">{t.name}</h1>
      <span class="slug faint">/topics/{t.slug}</span>
    </div>

    {#if data.user}
      <form method="POST" action="?/join" class="join-form">
        <button class="btn {isMember ? '' : 'btn-primary'}" type="submit">
          {isMember ? 'Joined' : 'Join'}
        </button>
      </form>
    {:else}
      <a class="btn btn-primary" href="/login">Join</a>
    {/if}
  </div>

  {#if t.description}
    <p class="desc">{t.description}</p>
  {/if}

  <div class="counts">
    <span><strong>{compact(t.counts.members)}</strong> members</span>
    <span><strong>{compact(t.counts.posts)}</strong> posts</span>
  </div>
</header>

<!-- topicId scopes the composer so posts land in this topic, not the global feed -->
{#if data.user}
  <Composer topicId={t.id} redirectTo={here} placeholder="Post to {t.name}…" />
{/if}

<div class="stack feed">
  {#each data.feed.data as post (post.id)}
    <PostCard {post} currentUser={data.user} redirectTo={here} />
  {:else}
    <p class="muted empty">No posts yet. Be the first to post here!</p>
  {/each}
</div>

{#if data.feed.nextCursor}
  <a class="btn more" href="{here}?after={data.feed.nextCursor}">Load more</a>
{/if}

<style>
  .topic-header {
    padding: var(--space-5);
    margin-bottom: var(--space-4);
  }
  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .back {
    font-family: var(--mono);
    font-size: 0.78rem;
  }
  .back:hover { text-decoration: underline; }
  .name { margin: 0; }
  .slug {
    font-family: var(--mono);
    font-size: 0.8rem;
  }
  .join-form { flex-shrink: 0; }
  .desc {
    margin: var(--space-3) 0 0;
    font-weight: 300;
  }
  .counts {
    display: flex;
    gap: var(--space-4);
    margin-top: var(--space-4);
    font-size: 0.9rem;
    color: var(--color-text-dim);
  }
  .counts strong { color: var(--color-text); }
  .feed { margin-top: var(--space-4); }
  .empty { padding: var(--space-6); text-align: center; }
  .more { margin: var(--space-4) auto 0; display: inline-flex; }
</style>
