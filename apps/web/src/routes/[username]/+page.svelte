<script lang="ts">
  import Avatar from '$lib/components/Avatar.svelte';
  import PostCard from '$lib/components/PostCard.svelte';
  import { compact } from '$lib/format';
  let { data } = $props();

  const p = $derived(data.profile);
  const isSelf = $derived(p.viewer?.isSelf ?? false);
  const isFollowing = $derived(p.viewer?.isFollowing ?? false);
  const here = $derived(`/${p.username}`);
</script>

<svelte:head><title>{p.displayName || p.username} · Counter</title></svelte:head>

<header class="profile panel">
  <div class="top">
    <Avatar user={p} size={76} />
    <div class="act">
      {#if isSelf}
        <a class="btn" href="/settings">Edit profile</a>
      {:else if data.user}
        <form method="POST" action="/actions/interact">
          <input type="hidden" name="kind" value={isFollowing ? 'unfollow' : 'follow'} />
          <input type="hidden" name="username" value={p.username} />
          <input type="hidden" name="redirectTo" value={here} />
          <button class="btn {isFollowing ? '' : 'btn-primary'}">{isFollowing ? 'Following' : 'Follow'}</button>
        </form>
      {:else}
        <a class="btn btn-primary" href="/login">Follow</a>
      {/if}
    </div>
  </div>

  <h1 class="name">
    {p.displayName || p.username}
    {#if p.verified}<span class="verified" title="verified">✦</span>{/if}
  </h1>
  <p class="handle faint">@{p.username}</p>
  {#if p.bio}<p class="bio">{p.bio}</p>{/if}

  <div class="counts">
    <span><strong>{compact(p.counts.posts)}</strong> posts</span>
    <a href="/{p.username}/following"><strong>{compact(p.counts.following)}</strong> following</a>
    <a href="/{p.username}/followers"><strong>{compact(p.counts.followers)}</strong> followers</a>
  </div>
</header>

<div class="stack list">
  {#each data.posts.data as post (post.id)}
    <PostCard {post} currentUser={data.user} redirectTo={here} />
  {:else}
    <p class="muted empty">No posts yet.</p>
  {/each}
</div>

{#if data.posts.nextCursor}
  <a class="btn more" href="{here}?after={data.posts.nextCursor}">Load more</a>
{/if}

<style>
  .profile {
    padding: var(--space-5);
  }
  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }
  .name {
    margin: var(--space-4) 0 0;
  }
  .verified {
    color: var(--color-accent);
    font-size: 0.7em;
  }
  .handle {
    margin: 0;
  }
  .bio {
    margin: var(--space-3) 0 0;
    font-weight: 300;
  }
  .counts {
    display: flex;
    gap: var(--space-4);
    margin-top: var(--space-4);
    font-size: 0.92rem;
    color: var(--color-text-dim);
  }
  .counts strong {
    color: var(--color-text);
  }
  .list {
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
