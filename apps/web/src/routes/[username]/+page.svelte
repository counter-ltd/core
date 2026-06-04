<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * A user's public profile: header (avatar, name, bio, counts) followed by
   * their posts. The same page serves three viewers: the owner, a logged-in
   * stranger, and a logged-out visitor, and the action button in the header
   * switches between Edit / Follow / Log in accordingly.
   */
  import Avatar from '$lib/components/Avatar.svelte';
  import PostCard from '$lib/components/PostCard.svelte';
  import { compact } from '$lib/format';
  let { data } = $props();

  const p = $derived(data.profile);
  // `viewer` is only populated when someone's logged in, so default both flags
  // to false for anonymous visitors rather than letting them read as undefined.
  const isSelf = $derived(p.viewer?.isSelf ?? false);
  const isFollowing = $derived(p.viewer?.isFollowing ?? false);
  // Where follow/unfollow and pagination links point back to: this profile.
  const here = $derived(`/${p.username}`);
</script>

<svelte:head><title>{p.displayName || p.username} · Counter</title></svelte:head>

<header class="profile panel">
  <div class="top">
    <Avatar user={p} size={76} />
    <!-- Header action depends on who's looking: your own profile gets Edit, a
         logged-in stranger gets a follow/unfollow form, and a guest gets a
         button that bounces them to login first. -->
    <div class="act">
      {#if isSelf}
        <a class="btn" href="/settings">Edit profile</a>
      {:else if data.user}
        <!-- One form toggles both ways; the hidden `kind` flips on current state -->
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

  <!-- Verified trust badges: each is one fact this person proved (a confirmed
       email, a linked account). Display only, they unlock nothing. -->
  {#if p.signals?.length}
    <ul class="signals">
      {#each p.signals as badge (badge.kind + (badge.href ?? badge.label))}
        <li>
          {#if badge.href}
            <a class="signal" href={badge.href} target="_blank" rel="noopener noreferrer me">
              ✦ {badge.label}{#if badge.detail}<span class="faint"> · {badge.detail}</span>{/if}
            </a>
          {:else}
            <span class="signal">✦ {badge.label}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

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
  .signals {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .signal {
    display: inline-flex;
    align-items: center;
    font-family: var(--mono);
    font-size: 0.72rem;
    color: var(--color-accent);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-pill);
    padding: 0.15em 0.7em;
  }
  a.signal:hover {
    border-color: var(--color-accent);
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
