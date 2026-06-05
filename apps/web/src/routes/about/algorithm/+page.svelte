<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Counter's "show your work" page: it publishes the live feed-ranking config
   * (weights + parameters) and a history of every change to it. The numbers
   * here are the exact ones the server ranks with, fetched from the algorithm
   * endpoint. `data.algorithm` is null when that endpoint is down.
   */
  import { timeAgo } from '$lib/format';
  let { data } = $props();
  const a = $derived(data.algorithm);
</script>

<svelte:head><title>The algorithm · Counter</title></svelte:head>

<header class="panel intro">
  <h1>The algorithm, in the open</h1>
  <p class="muted">
    This is the exact ranking that powers the public feed — the same weights the server computes with.
    No personalization profile. No individual tracking. Every change is logged below.
  </p>
</header>

<!-- The currently-live config. Hidden entirely if the endpoint didn't answer,
     since there's nothing trustworthy to show. -->
{#if a}
  <section class="panel card">
    <div class="spread">
      <h2>v{a.version}</h2>
      <span class="pill">live</span>
    </div>
    <p class="desc">{a.description}</p>

    <!-- weights and parameters are open-ended maps, so render whatever keys the
         server sends rather than hard-coding a fixed set here -->
    <h3 class="sub">Weights</h3>
    <div class="grid">
      {#each Object.entries(a.weights) as [k, v] (k)}
        <div class="kv"><code>{k}</code><strong>{v}</strong></div>
      {/each}
    </div>

    <h3 class="sub">Parameters</h3>
    <div class="grid">
      {#each Object.entries(a.parameters) as [k, v] (k)}
        <div class="kv"><code>{k}</code><strong>{String(v)}</strong></div>
      {/each}
    </div>
  </section>
{:else}
  <p class="muted">The algorithm endpoint is unavailable right now.</p>
{/if}

<section class="card">
  <h2 class="ch">Changelog</h2>
  <ol class="log">
    {#each data.changelog as e (e.id)}
      <li class="panel entry">
        <div class="spread">
          <strong>v{e.version} — {e.summary}</strong>
          <span class="faint">{timeAgo(e.deployedAt)}</span>
        </div>
        {#if e.detail}<p class="muted detail">{e.detail}</p>{/if}
        <p class="faint meta">by {e.changedBy} · <code>{e.commitHash}</code></p>
      </li>
    {:else}
      <li class="muted">No changes recorded yet.</li>
    {/each}
  </ol>
</section>

<style>
  .intro { padding: var(--space-5); margin-bottom: var(--space-4); }
  .intro h1 { font-size: 1.5rem; }
  .card { padding: var(--space-5); margin-bottom: var(--space-4); }
  .card h2 { margin: 0; }
  .desc { font-weight: 300; }
  .sub { margin: var(--space-4) 0 var(--space-2); font-size: 0.95rem; color: var(--color-text-dim); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-2); }
  .kv {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg-2);
    border-radius: var(--radius-sm);
  }
  .kv code { font-size: 0.82rem; color: var(--color-text-dim); }
  .ch { padding: 0 var(--space-1); }
  .log { list-style: none; padding: 0; margin: var(--space-3) 0 0; display: flex; flex-direction: column; gap: var(--space-3); }
  .entry { padding: var(--space-4); }
  .detail { margin: var(--space-2) 0; font-weight: 300; }
  .meta { margin: 0; font-size: 0.8rem; }
  code { font-family: ui-monospace, monospace; }
</style>
