<script lang="ts">
  import type { PublicUser, PrivateUser } from '@counter/types';
  import Avatar from './Avatar.svelte';

  let {
    user,
    currentUser = null,
    redirectTo = '/',
  }: { user: PublicUser; currentUser?: PrivateUser | null; redirectTo?: string } = $props();

  const isFollowing = $derived(user.viewer?.isFollowing ?? false);
  const isSelf = $derived(user.viewer?.isSelf ?? false);
</script>

<div class="urow panel">
  <Avatar {user} size={44} />
  <a href="/{user.username}" class="meta">
    <strong>{user.displayName || user.username}</strong>
    <small class="faint">@{user.username}</small>
    {#if user.bio}<span class="bio muted">{user.bio}</span>{/if}
  </a>
  {#if currentUser && !isSelf}
    <form method="POST" action="/actions/interact">
      <input type="hidden" name="kind" value={isFollowing ? 'unfollow' : 'follow'} />
      <input type="hidden" name="username" value={user.username} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <button class="btn {isFollowing ? '' : 'btn-primary'}">{isFollowing ? 'Following' : 'Follow'}</button>
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
