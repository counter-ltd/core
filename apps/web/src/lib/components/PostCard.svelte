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
   *                become "log in to..." links instead of live forms.
   *   redirectTo   Where the interact action returns to, so a like/repost lands
   *                you back on the page you did it from.
   *   nested       True when we're the embedded quote inside a repost.
   */
  import type { Post, PrivateUser } from '@counter/types';
  import Avatar from './Avatar.svelte';
  import PostCard from './PostCard.svelte';
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
  // viewer is absent for logged-out readers, so default these to false rather
  // than letting undefined drive the button state.
  const liked = $derived(post.viewer?.liked ?? false);
  const reposted = $derived(post.viewer?.reposted ?? false);
</script>

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
    {#if post.deleted}
      <p class="body deleted faint">[deleted]</p>
    {:else if post.body}
      <p class="body">{@html linkify(post.body)}</p>
    {/if}
  </a>

  {#if post.media.length}
    <div class="media">
      {#each post.media as m (m.id)}
        <img src={m.url} alt={m.altText ?? ''} loading="lazy" />
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
          <button class="act" class:on={reposted} title="Repost">
            <span class="ico">⇅</span>{compact(post.counts.reposts)}
          </button>
        </form>
        <form method="POST" action="/actions/interact" class="act-form">
          <input type="hidden" name="kind" value={liked ? 'unlike' : 'like'} />
          <input type="hidden" name="postId" value={post.id} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <button class="act like" class:on={liked} title="Like">
            <span class="ico">{liked ? '♥' : '♡'}</span>{compact(post.counts.likes)}
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
</article>

<style>
  .post {
    padding: var(--space-4);
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
    width: 100%;
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
</style>
