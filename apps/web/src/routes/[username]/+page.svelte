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

  // Inline SVGs for known platform badges. Uses currentColor so they adapt to
  // whatever color the .signal chip applies.
  const PLATFORM_LOGOS: Record<string, string> = {
    github: `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`,
    discord: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.114 18.1.133 18.115a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`,
  };

  /** Format an ISO timestamp as a short relative "X ago" string. */
  function timeAgo(iso: string): string {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  const p = $derived(data.profile);
  // `viewer` is only populated when someone's logged in, so default both flags
  // to false for anonymous visitors rather than letting them read as undefined.
  const isSelf = $derived(p.viewer?.isSelf ?? false);
  // Local state so the follow button flips instantly. Synced when navigating
  // between different profiles (p changes), but not invalidated mid-session.
  let isFollowing = $state(p.viewer?.isFollowing ?? false);
  let followerCount = $state(p.counts.followers);
  $effect(() => {
    isFollowing = p.viewer?.isFollowing ?? false;
    followerCount = p.counts.followers;
  });
  // Where follow/unfollow and pagination links point back to: this profile.
  const here = $derived(`/${p.username}`);

  async function toggleFollow(event: Event) {
    event.preventDefault();
    const was = isFollowing;
    isFollowing = !was;
    followerCount += was ? -1 : 1;
    try {
      await fetch('/actions/interact', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          kind: was ? 'unfollow' : 'follow',
          username: p.username,
          redirectTo: here,
        }),
      });
    } catch {
      isFollowing = was;
      followerCount += was ? 1 : -1;
    }
  }
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
          <button class="btn {isFollowing ? '' : 'btn-primary'}" onclick={toggleFollow}>{isFollowing ? 'Following' : 'Follow'}</button>
        </form>
        <a class="btn" href="/messages/{p.username}">Message</a>
      {:else}
        <a class="btn btn-primary" href="/login">Follow</a>
      {/if}
    </div>
  </div>

  <h1 class="name">
    {p.displayName || p.username}
    {#if p.verified}<span class="verified" title="verified">✦</span>{/if}
    {#if p.presence?.isOnline || (isSelf && p.viewer?.onlineStatusEnabled)}<span class="online-dot" title="Online now" aria-label="Online"></span>{/if}
  </h1>
  <p class="handle faint">
    @{p.username}
    {#if !p.presence?.isOnline && p.presence?.lastSeenAt}
      <span class="last-seen">· {timeAgo(p.presence.lastSeenAt)}</span>
    {/if}
  </p>
  {#if p.bio}<p class="bio">{p.bio}</p>{/if}

  <!-- Verified trust badges: each is one fact this person proved (a confirmed
       email, a linked account). Display only, they unlock nothing. -->
  {#if p.signals?.length}
    <ul class="signals">
      {#each p.signals as badge (badge.kind + (badge.href ?? badge.label))}
        <li>
          {#if badge.href}
            <a class="signal" href={badge.href} target="_blank" rel="noopener noreferrer me">
              {#if badge.platform && PLATFORM_LOGOS[badge.platform]}
                {@html PLATFORM_LOGOS[badge.platform]}
              {:else}
                ✦
              {/if}
              {#if badge.detail}
                <span>@{badge.detail}</span>
              {:else}
                <span>{badge.label}</span>
              {/if}
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
    <a href="/{p.username}/followers"><strong>{compact(followerCount)}</strong> followers</a>
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
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .online-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-repost);
    vertical-align: middle;
    margin-left: 4px;
    /* Subtle pulse so it reads as "live" at a glance. */
    animation: pulse 2.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }
  .last-seen {
    font-size: 0.85em;
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
    gap: 0.35em;
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
