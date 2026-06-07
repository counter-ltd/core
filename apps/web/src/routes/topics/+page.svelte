<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The topics discovery page at /topics: every community with its member and
   * post counts, plus an inline join/leave button for signed-in viewers.
   */
  import { compact } from '$lib/format';
  let { data } = $props();
</script>

<svelte:head><title>Topics · Counter</title></svelte:head>

<div class="head">
  <div class="head-text">
    <h1 class="title">Topics</h1>
    <p class="muted sub">Find communities around your interests.</p>
  </div>
  {#if data.user}
    <a class="btn btn-primary" href="/topics/new">New topic</a>
  {/if}
</div>

{#await data.topics then topics}
  {#if topics.length === 0}
    <p class="muted empty">No topics yet. Be the first to create one!</p>
  {:else}
    <div class="stack list">
      {#each topics as topic (topic.id)}
      <div class="topic-row panel">
        <div class="topic-info">
          <a href="/topics/{topic.slug}" class="topic-name">{topic.name}</a>
          <span class="topic-slug faint">/topics/{topic.slug}</span>
          {#if topic.description}
            <p class="topic-desc">{topic.description}</p>
          {/if}
          <div class="topic-counts faint">
            <span><strong>{compact(topic.counts.members)}</strong> members</span>
            <span><strong>{compact(topic.counts.posts)}</strong> posts</span>
          </div>
        </div>

        <div class="topic-act">
          <!-- One join/leave form per row: the `leaving` flag tells the action
               which direction to go, based on whether you're already a member.
               Guests get a plain link into the topic instead. -->
          {#if data.user}
            <form method="POST" action="?/join">
              <input type="hidden" name="slug" value={topic.slug} />
              <input type="hidden" name="leaving" value={topic.viewer?.isMember ? 'true' : 'false'} />
              <button class="btn {topic.viewer?.isMember ? '' : 'btn-primary'}" type="submit">
                {topic.viewer?.isMember ? 'Joined' : 'Join'}
              </button>
            </form>
          {:else}
            <a class="btn btn-primary" href="/topics/{topic.slug}">View</a>
          {/if}
        </div>
      </div>
    {/each}
  </div>
  {/if}
{/await}

<style>
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }
  .head-text { flex: 1; min-width: 0; }
  .title { margin: 0; }
  .sub { margin: 0; }

  .list { display: flex; flex-direction: column; gap: var(--space-3); }
  .topic-row {
    padding: var(--space-4);
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
  }
  .topic-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .topic-name { font-weight: 600; font-size: 1rem; }
  .topic-name:hover { text-decoration: underline; }
  .topic-slug { font-family: var(--mono); font-size: 0.78rem; }
  .topic-desc { margin: 0; font-size: 0.9rem; }
  .topic-counts {
    display: flex;
    gap: var(--space-4);
    font-size: 0.85rem;
  }
  .topic-counts strong { color: var(--color-text); }
  .topic-act { flex-shrink: 0; }
  .empty { padding: var(--space-6); text-align: center; }
</style>
