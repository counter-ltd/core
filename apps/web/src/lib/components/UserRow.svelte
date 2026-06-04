<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * A user in a list (followers, search results, suggestions): avatar, name,
   * handle, optional bio, and a follow/unfollow button.
   *
   * Props:
   *   user         The user this row is about.
   *   currentUser  The signed-in viewer, or null. The follow button only shows
   *                when someone's logged in and looking at someone else.
   *   redirectTo   Where the interact action returns to after follow/unfollow.
   */
  import type { PublicUser, PrivateUser } from '@counter/types';
  import Avatar from './Avatar.svelte';

  let {
    user,
    currentUser = null,
    redirectTo = '/',
  }: { user: PublicUser; currentUser?: PrivateUser | null; redirectTo?: string } = $props();

  // isSelf is stable for a given row; isFollowing is local state so the button
  // flips instantly without reloading the page.
  const isSelf = $derived(user.viewer?.isSelf ?? false);
  let isFollowing = $state(user.viewer?.isFollowing ?? false);

  async function toggleFollow(event: Event) {
    event.preventDefault();
    const was = isFollowing;
    isFollowing = !was;
    try {
      await fetch('/actions/interact', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          kind: was ? 'unfollow' : 'follow',
          username: user.username,
          redirectTo,
        }),
      });
    } catch {
      isFollowing = was;
    }
  }
</script>

<div class="urow panel">
  <Avatar {user} size={44} />
  <a href="/{user.username}" class="meta">
    <strong>{user.displayName || user.username}</strong>
    <small class="faint">@{user.username}</small>
    {#if user.bio}<span class="bio muted">{user.bio}</span>{/if}
  </a>
  <!-- No follow button for logged-out viewers or on your own row. -->
  {#if currentUser && !isSelf}
    <form method="POST" action="/actions/interact">
      <input type="hidden" name="kind" value={isFollowing ? 'unfollow' : 'follow'} />
      <input type="hidden" name="username" value={user.username} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <button class="btn {isFollowing ? '' : 'btn-primary'}" onclick={toggleFollow}>{isFollowing ? 'Following' : 'Follow'}</button>
    </form>
  {/if}
</div>

<style>
  .urow {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }
  .meta {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
    flex: 1;
    min-width: 0;
  }
  .meta small {
    font-size: 0.8rem;
  }
  .bio {
    font-size: 0.86rem;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
