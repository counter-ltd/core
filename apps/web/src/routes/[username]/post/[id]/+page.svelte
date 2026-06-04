<script lang="ts">
  import PostCard from '$lib/components/PostCard.svelte';
  import Composer from '$lib/components/Composer.svelte';
  let { data } = $props();

  const t = $derived(data.thread);
  const here = $derived(`/${t.post.author.username}/post/${t.post.id}`);
</script>

<svelte:head>
  <title>{t.post.author.displayName || t.post.author.username} on Counter</title>
</svelte:head>

{#if t.ancestors.length}
  <div class="stack ancestors">
    {#each t.ancestors as a (a.id)}
      <PostCard post={a} currentUser={data.user} redirectTo={here} />
    {/each}
    <div class="thread-line" aria-hidden="true"></div>
  </div>
{/if}

<div class="focus">
  <PostCard post={t.post} currentUser={data.user} redirectTo={here} />
</div>

{#if data.user}
  <div class="reply">
    <Composer parentId={t.post.id} redirectTo={here} placeholder="Post your reply…" cta="Reply" />
  </div>
{:else}
  <p class="muted login-hint panel"><a href="/login">Log in</a> to reply.</p>
{/if}

<h2 class="rtitle">{t.replies.length ? 'Replies' : 'No replies yet'}</h2>
<div class="stack">
  {#each t.replies as r (r.id)}
    <PostCard post={r} currentUser={data.user} redirectTo={here} />
  {/each}
</div>

<style>
  .ancestors {
    margin-bottom: var(--space-3);
    opacity: 0.85;
  }
  .thread-line {
    width: 2px;
    height: var(--space-4);
    margin-left: 38px;
    background: var(--color-border-bright);
  }
  .focus :global(.post) {
    border-color: var(--color-border-bright);
  }
  .reply {
    margin: var(--space-4) 0;
  }
  .login-hint {
    padding: var(--space-4);
    margin: var(--space-4) 0;
    text-align: center;
  }
  .rtitle {
    font-size: 1.05rem;
    margin: var(--space-5) 0 var(--space-3);
    color: var(--color-text-dim);
  }
</style>
