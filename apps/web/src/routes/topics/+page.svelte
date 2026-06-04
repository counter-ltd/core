<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The topics directory: a list of every topic with member/post counts and a
   * join button, plus an inline "create a topic" form that members can toggle
   * open. `form` carries validation errors and the values to refill on a failed
   * create.
   */
  import { compact } from '$lib/format';
  import type { ActionData } from './$types';

  let { data, form }: { data: any; form: ActionData } = $props();

  // Toggles the create-topic form. Starts hidden so the page leads with the list.
  let showCreate = $state(false);
</script>

<svelte:head><title>Topics · Counter</title></svelte:head>

<div class="head">
  <h1 class="title">Topics</h1>
  <p class="muted sub">Find communities around your interests.</p>
  {#if data.user}
    <button class="btn btn-primary" onclick={() => (showCreate = !showCreate)}>
      {showCreate ? 'Cancel' : 'New topic'}
    </button>
  {/if}
</div>

{#if showCreate}
  <form method="POST" action="?/create" class="panel create-form">
    <h2 class="form-title">Create a topic</h2>

    {#if form?.error}
      <p class="error">{form.error}</p>
    {/if}

    <label class="field">
      <span class="label">Slug <span class="faint">(URL name, e.g. photography)</span></span>
      <input
        type="text"
        name="slug"
        required
        minlength="2"
        maxlength="50"
        pattern="[a-z][a-z0-9_-]*"
        placeholder="photography"
        value={form?.slug ?? ''}
      />
    </label>

    <label class="field">
      <span class="label">Display name</span>
      <input
        type="text"
        name="name"
        required
        maxlength="100"
        placeholder="Photography"
        value={form?.name ?? ''}
      />
    </label>

    <label class="field">
      <span class="label">Description <span class="faint">(optional)</span></span>
      <textarea name="description" maxlength="500" placeholder="What's this topic about?">{form?.description ?? ''}</textarea>
    </label>

    <button class="btn btn-primary" type="submit">Create topic</button>
  </form>
{/if}

{#if data.topics.length === 0}
  <p class="muted empty">No topics yet. Be the first to create one!</p>
{:else}
  <div class="stack list">
    {#each data.topics as topic (topic.id)}
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

<style>
  .head {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .title { margin: 0; flex: 1 1 100%; }
  .sub { margin: 0; flex: 1 1 100%; }
  .head .btn { margin-left: auto; }

  .create-form {
    padding: var(--space-5);
    margin-bottom: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .form-title { margin: 0; font-size: 1rem; }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .label { font-size: 0.85rem; }
  .error {
    color: var(--color-error, #e53);
    font-size: 0.88rem;
    margin: 0;
  }

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
