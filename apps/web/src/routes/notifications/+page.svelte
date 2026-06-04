<script lang="ts">
  import Avatar from '$lib/components/Avatar.svelte';
  import { timeAgo } from '$lib/format';
  import type { Notification } from '@counter/types';
  let { data } = $props();

  const verbs: Record<Notification['type'], string> = {
    like: 'liked your post',
    repost: 'reposted your post',
    reply: 'replied to you',
    follow: 'followed you',
    mention: 'mentioned you',
  };

  function target(n: Notification): string {
    if (n.post) return `/${n.post.author.username}/post/${n.post.id}`;
    return `/${n.actor.username}`;
  }
</script>

<svelte:head><title>Notifications · Counter</title></svelte:head>

<div class="spread head">
  <h1 class="title">Notifications</h1>
  <form method="POST" action="?/readAll"><button class="btn">Mark all read</button></form>
</div>

<div class="stack">
  {#each data.notifications.data as n (n.id)}
    <a class="note panel" class:unread={!n.read} href={target(n)}>
      <Avatar user={n.actor} size={40} />
      <div class="txt">
        <span>
          <strong>{n.actor.displayName || n.actor.username}</strong>
          <span class="muted">{verbs[n.type]}</span>
        </span>
        {#if n.post?.body}<span class="snippet faint">{n.post.body}</span>{/if}
      </div>
      <span class="time faint">{timeAgo(n.createdAt)}</span>
    </a>
  {:else}
    <p class="muted empty">Nothing yet. Engagement will show up here.</p>
  {/each}
</div>

{#if data.notifications.nextCursor}
  <a class="btn more" href="/notifications?after={data.notifications.nextCursor}">Load more</a>
{/if}

<style>
  .head { margin-bottom: var(--space-4); }
  .title { margin: 0; }
  .note {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }
  .note.unread {
    border-color: var(--color-accent);
  }
  .txt {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .snippet {
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .time { white-space: nowrap; font-size: 0.82rem; }
  .empty { padding: var(--space-6); text-align: center; }
  .more { margin: var(--space-4) auto 0; display: inline-flex; }
</style>
