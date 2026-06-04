<script lang="ts">
  import { compact } from '$lib/format';
  let { data } = $props();

  const referrerColors: Record<string, string> = {
    feed: 'var(--color-accent)',
    profile: 'var(--color-accent-2)',
    search: 'var(--color-repost)',
    direct: 'var(--color-text-dim)',
    external: 'var(--color-like)',
  };

  const postBreakdown = $derived(
    data.post
      ? Object.entries(data.post.viewsByReferrer).filter(([, v]) => v > 0)
      : [],
  );
  const postMax = $derived(
    data.post ? Math.max(1, ...Object.values(data.post.viewsByReferrer)) : 1,
  );
</script>

<svelte:head><title>Insights · Counter</title></svelte:head>

<h1 class="title">Insights</h1>
<p class="muted sub">Open from your first post. No follower gate, ever. Views are anonymous counts.</p>

{#if data.post}
  <section class="panel card">
    <h2>Post insights</h2>
    <div class="stats">
      <div class="stat"><strong>{compact(data.post.views)}</strong><span class="faint">views</span></div>
      <div class="stat"><strong>{compact(data.post.likes)}</strong><span class="faint">likes</span></div>
      <div class="stat"><strong>{compact(data.post.reposts)}</strong><span class="faint">reposts</span></div>
      <div class="stat"><strong>{compact(data.post.replies)}</strong><span class="faint">replies</span></div>
      <div class="stat">
        <strong>{data.post.engagementRate === null ? '—' : (data.post.engagementRate * 100).toFixed(1) + '%'}</strong>
        <span class="faint">engagement</span>
      </div>
    </div>

    {#if postBreakdown.length}
      <h3 class="sub2">Where views came from</h3>
      <div class="bars">
        {#each postBreakdown as [ref, n] (ref)}
          <div class="barrow">
            <span class="rlabel">{ref}</span>
            <div class="track">
              <div class="fill" style="width:{(n / postMax) * 100}%; background:{referrerColors[ref]}"></div>
            </div>
            <span class="rval faint">{n}</span>
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

{#if data.profile}
  <section class="panel card">
    <h2>Your profile</h2>
    <div class="stats">
      <div class="stat"><strong>{compact(data.profile.totalPosts)}</strong><span class="faint">posts</span></div>
      <div class="stat"><strong>{compact(data.profile.totalViews)}</strong><span class="faint">views</span></div>
      <div class="stat"><strong>{compact(data.profile.totalLikes)}</strong><span class="faint">likes</span></div>
      <div class="stat"><strong>{compact(data.profile.totalReposts)}</strong><span class="faint">reposts</span></div>
      <div class="stat"><strong>{compact(data.profile.totalReplies)}</strong><span class="faint">replies</span></div>
      <div class="stat"><strong>{compact(data.profile.followers)}</strong><span class="faint">followers</span></div>
    </div>

    {#if data.profile.topPosts.length}
      <h3 class="sub2">Top posts by views</h3>
      <div class="stack">
        {#each data.profile.topPosts as p (p.postId)}
          <a class="toprow" href="/insights?post={p.postId}">
            <span class="snip">{p.body ?? '[no text]'}</span>
            <span class="pill">{compact(p.views)} views</span>
          </a>
        {/each}
      </div>
    {/if}
  </section>
{/if}

{#if data.platform}
  <section class="panel card">
    <h2>Platform-wide</h2>
    <p class="muted">Public aggregate stats. No individual is identifiable.</p>
    <div class="stats">
      <div class="stat"><strong>{compact(data.platform.users)}</strong><span class="faint">people</span></div>
      <div class="stat"><strong>{compact(data.platform.posts)}</strong><span class="faint">posts</span></div>
      <div class="stat"><strong>{compact(data.platform.views)}</strong><span class="faint">views</span></div>
      <div class="stat"><strong>{compact(data.platform.likes)}</strong><span class="faint">likes</span></div>
      <div class="stat"><strong>{compact(data.platform.reposts)}</strong><span class="faint">reposts</span></div>
    </div>
  </section>
{/if}

<style>
  .title { margin-bottom: 0; }
  .sub { margin-top: 0; margin-bottom: var(--space-4); }
  .card { padding: var(--space-5); margin-bottom: var(--space-4); }
  .card h2 { font-size: 1.15rem; }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .stat {
    display: flex;
    flex-direction: column;
    padding: var(--space-3);
    background: var(--color-bg-2);
    border-radius: var(--radius-sm);
  }
  .stat strong { font-size: 1.4rem; font-weight: 600; }
  .stat span { font-size: 0.78rem; }
  .sub2 { margin: var(--space-5) 0 var(--space-3); font-size: 0.95rem; color: var(--color-text-dim); }
  .bars { display: flex; flex-direction: column; gap: var(--space-2); }
  .barrow { display: grid; grid-template-columns: 80px 1fr 40px; align-items: center; gap: var(--space-3); }
  .rlabel { font-size: 0.82rem; color: var(--color-text-dim); text-transform: capitalize; }
  .track { height: 10px; background: var(--color-bg-2); border-radius: var(--radius-pill); overflow: hidden; }
  .fill { height: 100%; border-radius: var(--radius-pill); }
  .rval { font-size: 0.82rem; text-align: right; }
  .toprow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-bg-2);
    border-radius: var(--radius-sm);
  }
  .snip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
