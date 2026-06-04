<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The list of accounts this user follows. Mirror image of the followers page:
   * same UserRow list, same pagination. `here` keeps each row's follow action
   * redirecting back to this list.
   */
  import UserRow from '$lib/components/UserRow.svelte';
  let { data } = $props();
  const here = $derived(`/${data.username}/following`);
</script>

<svelte:head><title>Who {data.username} follows · Counter</title></svelte:head>

<h1 class="title"><a href="/{data.username}">@{data.username}</a> · following</h1>

<div class="stack">
  {#each data.list.data as u (u.id)}
    <UserRow user={u} currentUser={data.user} redirectTo={here} />
  {:else}
    <p class="muted empty">Not following anyone yet.</p>
  {/each}
</div>

{#if data.list.nextCursor}
  <a class="btn more" href="{here}?after={data.list.nextCursor}">Load more</a>
{/if}

<style>
  .title { font-size: 1.2rem; margin-bottom: var(--space-4); }
  .empty { padding: var(--space-6); text-align: center; }
  .more { margin: var(--space-4) auto 0; display: inline-flex; }
</style>
