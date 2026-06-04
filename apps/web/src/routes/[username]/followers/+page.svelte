<script lang="ts">
  import UserRow from '$lib/components/UserRow.svelte';
  let { data } = $props();
  const here = $derived(`/${data.username}/followers`);
</script>

<svelte:head><title>{data.username}'s followers · Counter</title></svelte:head>

<h1 class="title"><a href="/{data.username}">@{data.username}</a> · followers</h1>

<div class="stack">
  {#each data.list.data as u (u.id)}
    <UserRow user={u} currentUser={data.user} redirectTo={here} />
  {:else}
    <p class="muted empty">No followers yet.</p>
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
