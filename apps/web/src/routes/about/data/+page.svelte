<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Renders the data-collection disclosure. The content isn't held here; the
   * load fetches and parses DATA-MODEL.md from the public docs repo into
   * `data.doc` (title, intro blocks, and `##` sections). Blocks are rendered
   * from structured data, never `{@html}`, so the remote markdown can't inject
   * anything. `data.error` is set when the fetch or parse fails.
   */
  import type { Run, Block } from './+page.server';
  let { data } = $props();
</script>

<svelte:head><title>Your data · Counter</title></svelte:head>

{#snippet runs(parts: Run[])}
  {#each parts as run (run)}
    {#if run.code}<code>{run.t}</code>
    {:else if run.strong}<strong>{run.t}</strong>
    {:else}{run.t}{/if}
  {/each}
{/snippet}

{#snippet blocks(list: Block[])}
  {#each list as block, i (i)}
    {#if block.type === 'p'}
      <p>{@render runs(block.runs)}</p>
    {:else if block.type === 'code'}
      <pre><code>{block.code}</code></pre>
    {:else if block.type === 'list'}
      <ul>
        {#each block.items as item, j (j)}<li>{@render runs(item)}</li>{/each}
      </ul>
    {:else if block.type === 'table'}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>{#each block.head as cell, j (j)}<th>{@render runs(cell)}</th>{/each}</tr>
          </thead>
          <tbody>
            {#each block.rows as row, r (r)}
              <tr>{#each row as cell, c (c)}<td>{@render runs(cell)}</td>{/each}</tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/each}
{/snippet}

<header class="panel intro">
  <h1>{data.doc?.title ?? 'Your data'}</h1>
  <p class="muted">
    Everything Counter stores about you, why, and for how long. Fetched live from
    <a
      href="https://github.com/counter-ltd/documents/blob/main/DATA-MODEL.md"
      target="_blank"
      rel="noopener noreferrer"
      class="src-link">counter-ltd/documents</a
    >, the same source the platform commits to keeping current.
  </p>
</header>

{#if data.error}
  <p class="panel muted err">{data.error}</p>
{:else if data.doc}
  {#if data.doc.intro.length}
    <section class="panel block">{@render blocks(data.doc.intro)}</section>
  {/if}
  {#each data.doc.sections as section (section.title)}
    <section class="panel block">
      <h2>{section.title}</h2>
      {@render blocks(section.blocks)}
    </section>
  {/each}
{/if}

<style>
  .intro { padding: var(--space-5); margin-bottom: var(--space-4); }
  .intro h1 { font-size: 1.5rem; }
  .src-link { color: var(--color-accent); text-decoration: none; }
  .src-link:hover { text-decoration: underline; }
  .err { padding: var(--space-4); }
  .block { padding: var(--space-5); margin-bottom: var(--space-4); }
  .block h2 {
    margin: 0 0 var(--space-3);
    font-family: var(--mono);
    font-size: 1rem;
    letter-spacing: 0.02em;
  }
  .block p { line-height: 1.6; font-weight: 300; margin: var(--space-3) 0; }
  .block :global(code) {
    font-family: var(--mono);
    font-size: 0.85em;
    background: var(--color-surface-strong);
    padding: 0.1em 0.35em;
    border-radius: var(--radius-sm);
  }
  pre {
    margin: var(--space-3) 0;
    padding: var(--space-3);
    background: var(--color-surface-strong);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    overflow-x: auto;
  }
  pre code { background: none; padding: 0; font-size: 0.8rem; line-height: 1.5; }
  ul { margin: var(--space-3) 0; padding-left: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
  li { font-weight: 300; line-height: 1.5; }
  .table-wrap { overflow-x: auto; margin: var(--space-3) 0; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td {
    text-align: left;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
    vertical-align: top;
  }
  th {
    font-family: var(--mono);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-dim);
    font-weight: 600;
  }
  td { font-weight: 300; line-height: 1.5; }
</style>
