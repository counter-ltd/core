<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * One post in a feed or thread: author header, body, any media, and the
   * reply / repost / like / views action bar.
   *
   * This component renders itself. A repost embeds the post it quotes by
   * mounting another PostCard with `nested` set, which is why the import below
   * points back at this file. Nested cards are display-only: they drop the
   * topic badge and the whole action bar so a quoted post can't be acted on
   * from inside its wrapper.
   *
   * Props:
   *   post         The post to render.
   *   currentUser  The signed-in viewer, or null. When null the action buttons
   *                become "log in to..." links instead of live forms. Their
   *                permissions also decide whether the bottom-right moderation
   *                control shows (a moderator gets it, a normal user never does).
   *   redirectTo   Where the interact action returns to, so a like/repost lands
   *                you back on the page you did it from.
   *   nested       True when we're the embedded quote inside a repost.
   */
  import type { Post, PrivateUser } from '@counter/types';
  import Avatar from './Avatar.svelte';
  import PostCard from './PostCard.svelte';
  import DiscordQuoteCard from './DiscordQuoteCard.svelte';
  import { timeAgo, compact, linkify } from '$lib/format';

  let {
    post,
    currentUser = null,
    redirectTo = '/',
    nested = false,
  }: {
    post: Post;
    currentUser?: PrivateUser | null;
    redirectTo?: string;
    nested?: boolean;
  } = $props();

  const permalink = $derived(`/${post.author.username}/post/${post.id}`);

  // The per-post controls menu (bottom-right) is moderation-only for now, so it
  // shows only when the viewer carries `posts.moderate`. A normal account has an
  // empty permission list and never sees the icon. Gated like the rest of the
  // bar to top-level cards so a quoted post can't be moderated from inside its
  // wrapper. New post-scoped permissions slot in as extra menu items, same gate.
  const canModerate = $derived(currentUser?.permissions.includes('posts.moderate') ?? false);
  // Nuke is the hard, irreversible delete (post + all replies and reposts). It
  // rides its own permission so a moderator with only soft-delete power can't
  // reach it. The menu shows whenever the viewer has either capability.
  const canNuke = $derived(currentUser?.permissions.includes('posts.nuke') ?? false);
  const showControls = $derived((canModerate || canNuke) && !nested);

  // Moderation state we flip locally so an action lands without a page reload.
  // A nuke removes the card outright; remove/restore swap the body to/from the
  // [deleted] tombstone. The `<form>`s still post for no-JS clients; with JS the
  // handler below intercepts and updates these instead.
  let nuked = $state(false);
  let displayDeleted = $state(post.deleted);
  let menuEl = $state<HTMLDetailsElement>();

  /**
   * Run one moderation action over fetch and update the card in place.
   *
   * `redirect: 'manual'` so we don't follow the endpoint's 303 back to a full
   * page (the whole point is to avoid the reload, which is what lets a moderator
   * nuke through a feed quickly). On failure the card is left untouched.
   */
  async function moderate(kind: 'remove' | 'restore' | 'nuke', event: Event) {
    event.preventDefault();
    if (kind === 'nuke') {
      const ok = confirm(
        'Nuke this post? It deletes the post and every reply and repost permanently. This cannot be undone.',
      );
      if (!ok) return;
    }
    menuEl?.removeAttribute('open');
    try {
      await fetch('/actions/moderate', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ kind, postId: post.id, redirectTo }),
        redirect: 'manual',
      });
      if (kind === 'nuke') nuked = true;
      else displayDeleted = kind === 'remove';
    } catch {
      // Leave the card as-is; the moderator can retry.
    }
  }

  // $state instead of $derived so we can update these without triggering a
  // page reload. Cards are keyed by post.id so each instance starts fresh.
  // Server truth comes back on the next full navigation.
  let liked = $state(post.viewer?.liked ?? false);
  let reposted = $state(post.viewer?.reposted ?? false);
  let likeCount = $state(post.counts.likes);
  let repostCount = $state(post.counts.reposts);

  async function interact(kind: string) {
    await fetch('/actions/interact', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ kind, postId: post.id, redirectTo }),
    });
  }

  // Toggle like with an optimistic flip. Reverts on network error.
  async function toggleLike(event: Event) {
    event.preventDefault();
    const was = liked;
    liked = !was;
    likeCount += was ? -1 : 1;
    try {
      await interact(was ? 'unlike' : 'like');
    } catch {
      liked = was;
      likeCount += was ? 1 : -1;
    }
  }

  async function toggleRepost(event: Event) {
    event.preventDefault();
    const was = reposted;
    reposted = !was;
    repostCount += was ? -1 : 1;
    try {
      await interact(was ? 'unrepost' : 'repost');
    } catch {
      reposted = was;
      repostCount += was ? 1 : -1;
    }
  }
</script>

{#if !nuked}
<article class="post panel" class:nested>
  <div class="head">
    <Avatar user={post.author} size={nested ? 34 : 44} />
    <div class="who">
      <a href="/{post.author.username}" class="name">
        {post.author.displayName || post.author.username}
        {#if post.author.verified}<span class="verified" title="verified">✦</span>{/if}
      </a>
      <a href="/{post.author.username}" class="handle faint">@{post.author.username}</a>
    </div>
    <a href={permalink} class="time faint">{timeAgo(post.createdAt)}{post.edited ? ' · edited' : ''}</a>
  </div>

  <!-- Topic badge only on top-level cards; a quoted post hides its own topic. -->
  {#if post.topic && !nested}
    <a href="/topics/{post.topic.slug}" class="topic-badge faint">▦ {post.topic.name}</a>
  {/if}

  <!-- linkify turns @mentions and #tags into anchors, hence the {@html}. It
       must sanitise its input since the body is user-authored. -->
  <a href={permalink} class="bodylink">
    {#if displayDeleted}
      <p class="body deleted faint">[deleted]</p>
    {:else if post.sourceMeta?.type === 'discord_share'}
      <!-- Render the structured Discord quote card; the plain body is the fallback
           for clients that don't understand sourceMeta. -->
      <DiscordQuoteCard meta={post.sourceMeta} />
    {:else if post.body}
      <p class="body">{@html linkify(post.body)}</p>
    {/if}
  </a>

  {#if post.media.length}
    <div class="media">
      {#each post.media as m (m.id)}
        <img src={m.url} alt={m.altText ?? ''} loading="lazy"
          width={m.width ?? undefined} height={m.height ?? undefined} />
      {/each}
    </div>
  {/if}

  <!-- The quoted post, rendered as a nested (display-only) card. -->
  {#if post.repostOf}
    <PostCard post={post.repostOf} {currentUser} {redirectTo} nested={true} />
  {/if}

  <!-- Action bar is top-level only, so you can't interact with a quoted post. -->
  {#if !nested}
    <div class="actions">
      <a class="act" href={permalink} title="Reply">
        <span class="ico">↩</span>{compact(post.counts.replies)}
      </a>

      <!-- Logged in: real forms that toggle state. The same button does and
           undoes the action; current state picks which verb we send. Logged
           out: the buttons fall back to login links below. -->
      {#if currentUser}
        <form method="POST" action="/actions/interact" class="act-form">
          <input type="hidden" name="kind" value={reposted ? 'unrepost' : 'repost'} />
          <input type="hidden" name="postId" value={post.id} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <button class="act" class:on={reposted} title="Repost" onclick={toggleRepost}>
            <span class="ico">⇅</span>{compact(repostCount)}
          </button>
        </form>
        <form method="POST" action="/actions/interact" class="act-form">
          <input type="hidden" name="kind" value={liked ? 'unlike' : 'like'} />
          <input type="hidden" name="postId" value={post.id} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <button class="act like" class:on={liked} title="Like" onclick={toggleLike}>
            <span class="ico">{liked ? '♥' : '♡'}</span>{compact(likeCount)}
          </button>
        </form>
      {:else}
        <a class="act" href="/login" title="Log in to repost"><span class="ico">⇅</span>{compact(post.counts.reposts)}</a>
        <a class="act like" href="/login" title="Log in to like"><span class="ico">♡</span>{compact(post.counts.likes)}</a>
      {/if}

      <a class="act" href="/insights?post={post.id}" title="Insights — open from post one">
        <span class="ico">▦</span>{compact(post.counts.views)}
      </a>
    </div>
  {/if}

  <!-- Moderation menu, pinned bottom-right. <details> gives a dropdown with no
       JS, so it works on the SSR'd page before hydration. The forms post to the
       moderation action endpoint, which forwards to the admin API where the
       permission is actually enforced. -->
  {#if showControls}
    <details class="controls" bind:this={menuEl}>
      <summary class="ctl-toggle" title="Moderate" aria-label="Post controls">⋯</summary>
      <div class="ctl-menu panel">
        {#if canModerate}
          {#if displayDeleted}
            <form method="POST" action="/actions/moderate">
              <input type="hidden" name="kind" value="restore" />
              <input type="hidden" name="postId" value={post.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <button class="ctl-item" onclick={(e) => moderate('restore', e)}>Restore post</button>
            </form>
          {:else}
            <form method="POST" action="/actions/moderate">
              <input type="hidden" name="kind" value="remove" />
              <input type="hidden" name="postId" value={post.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <button class="ctl-item danger" onclick={(e) => moderate('remove', e)}>Remove post</button>
            </form>
          {/if}
        {/if}
        {#if canNuke}
          <form method="POST" action="/actions/moderate">
            <input type="hidden" name="kind" value="nuke" />
            <input type="hidden" name="postId" value={post.id} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <button class="ctl-item danger" onclick={(e) => moderate('nuke', e)}>Nuke post</button>
          </form>
        {/if}
      </div>
    </details>
  {/if}
</article>
{/if}

<style>
  .post {
    padding: var(--space-4);
    /* Anchor for the bottom-right moderation control. */
    position: relative;
  }
  .post.nested {
    margin-top: var(--space-3);
    background: var(--color-bg-2);
    box-shadow: none;
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .who {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    min-width: 0;
  }
  .name {
    font-weight: 500;
  }
  .verified {
    color: var(--color-accent);
    font-size: 0.8em;
  }
  .handle {
    font-family: var(--mono);
    font-size: 0.78rem;
  }
  .topic-badge {
    display: inline-block;
    margin-top: var(--space-2);
    font-family: var(--mono);
    font-size: 0.74rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 1px 6px;
  }
  .topic-badge:hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .time {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 0.76rem;
    white-space: nowrap;
  }
  .bodylink {
    display: block;
    color: inherit;
  }
  .bodylink:hover {
    color: inherit;
  }
  .body {
    margin: var(--space-3) 0 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-size: 1rem;
    line-height: 1.55;
  }
  .body.deleted {
    font-style: italic;
  }
  :global(.body .tag),
  :global(.body .mention) {
    color: var(--color-accent);
  }
  .media {
    margin-top: var(--space-3);
    display: grid;
    gap: var(--space-2);
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }
  .media img {
    display: block;
    width: 100%;
    /* Scale to the column width and cap the height, so a tall screenshot can't
       blow out the card. height:auto neutralizes the intrinsic height attribute
       (which otherwise forced the natural pixel height and squashed the image);
       the width/height attrs still give the browser an aspect ratio to reserve
       space and avoid layout shift. object-fit:cover crops rather than warps. */
    height: auto;
    max-height: 512px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    margin-top: var(--space-4);
  }
  /* Each action is wrapped in its own <form>, but we don't want those form
     boxes breaking up the flex row. display:contents makes the form vanish
     from layout so its button sits in the bar as if the form weren't there. */
  .act-form {
    display: contents;
  }
  .act {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    padding: 0;
    font-family: var(--mono);
    font-size: 0.78rem;
    color: var(--color-text-dim);
    cursor: pointer;
  }
  .act:hover {
    color: var(--color-accent);
  }
  .act.like:hover,
  .act.like.on {
    color: var(--color-like);
  }
  .act.on {
    color: var(--color-repost);
  }
  .ico {
    font-size: 1.05rem;
    line-height: 1;
  }

  /* --- moderation control --- */
  .controls {
    position: absolute;
    bottom: var(--space-3);
    right: var(--space-3);
  }
  .ctl-toggle {
    list-style: none; /* kill the default disclosure triangle */
    cursor: pointer;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    color: var(--color-text-dim);
    font-size: 1.1rem;
    line-height: 1;
  }
  .ctl-toggle::-webkit-details-marker {
    display: none;
  }
  .ctl-toggle:hover {
    color: var(--color-text);
    background: var(--color-bg-2);
  }
  /* The menu floats up-and-left from the toggle so it never spills off the
     card's right edge or collides with the action bar below. */
  .ctl-menu {
    position: absolute;
    bottom: calc(100% + var(--space-1));
    right: 0;
    min-width: 150px;
    padding: var(--space-1);
    z-index: 5;
  }
  .ctl-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    color: var(--color-text);
    cursor: pointer;
  }
  .ctl-item:hover {
    background: var(--color-bg-2);
  }
  .ctl-item.danger {
    color: var(--color-like);
  }
</style>
