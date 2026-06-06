<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The report queue: a status filter and one card per report. Each card links
   * to the reported post or profile, and offers resolve/dismiss (with
   * `reports.resolve`) plus an inline post removal (with `posts.moderate`). Open
   * reports are the default view; the filter shows resolved/dismissed history.
   */
  import { enhance } from '$app/forms';
  import type { Permission } from '@counter/config';
  import Select from '$lib/components/Select.svelte';

  let { data, form } = $props();

  const perms = $derived(data.permissions as Permission[]);
  const canResolve = $derived(perms.includes('reports.resolve'));
  const canModerate = $derived(perms.includes('posts.moderate'));

  let filterForm = $state<HTMLFormElement | null>(null);
</script>

<form method="GET" class="filters" bind:this={filterForm}>
  <Select
    name="status"
    aria-label="Filter by status"
    value={data.status}
    options={[
      {value: 'open', label: 'open'},
      {value: 'resolved', label: 'resolved'},
      {value: 'dismissed', label: 'dismissed'},
    ]}
    onchange={() => filterForm?.requestSubmit()}
  />
</form>

{#if form?.error}<p class="error">{form.error}</p>{/if}
{#if form?.saved}<p class="ok">Done.</p>{/if}

{#if data.reports.length === 0}
  <p class="faint">Nothing in this queue.</p>
{/if}

<ul class="rows">
  {#each data.reports as r (r.id)}
    <li class="card report" class:done={r.status !== 'open'}>
      <div class="head">
        <span class="reason">{r.reason}</span>
        <span class="ttype">{r.targetType}</span>
        <code class="target faint">{r.targetId.slice(0, 8)}</code>
        <small class="faint">{new Date(r.createdAt).toLocaleString()}</small>
      </div>
      {#if r.detail}<p class="detail">{r.detail}</p>{/if}
      <p class="meta faint">
        by {r.reporter ? `@${r.reporter.username}` : 'deleted user'}
        {#if r.status !== 'open'}
          · {r.status}{r.resolvedBy ? ` by @${r.resolvedBy.username}` : ''}
        {/if}
      </p>

      {#if r.status === 'open' && (canResolve || canModerate)}
        <div class="actions">
          {#if canResolve}
            <form method="POST" action="?/resolve" use:enhance>
              <input type="hidden" name="reportId" value={r.id} />
              <input type="hidden" name="status" value="resolved" />
              <button class="btn" type="submit">resolve</button>
            </form>
            <form method="POST" action="?/resolve" use:enhance>
              <input type="hidden" name="reportId" value={r.id} />
              <input type="hidden" name="status" value="dismissed" />
              <button class="btn" type="submit">dismiss</button>
            </form>
          {/if}
          {#if canModerate && r.targetType === 'post'}
            <form method="POST" action="?/removePost" use:enhance>
              <input type="hidden" name="postId" value={r.targetId} />
              <button class="btn btn-danger" type="submit">remove post</button>
            </form>
          {/if}
        </div>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .filters {
    margin-bottom: var(--space-3);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .report {
    padding: var(--space-3) var(--space-4);
    /* Left rail flags state: amber while the report is open and needs a call,
       quiet once it's been resolved or dismissed. */
    border-left: 2px solid var(--color-accent);
  }
  .report.done {
    border-left-color: var(--color-border);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .reason {
    font-weight: 600;
    text-transform: capitalize;
  }
  .ttype {
    font-family: var(--mono);
    font-size: 0.7rem;
    padding: 1px 6px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-pill);
    color: var(--color-text-dim);
  }
  .detail {
    margin: var(--space-2) 0 0;
    font-size: 0.88rem;
  }
  .meta {
    margin: var(--space-2) 0 0;
    font-size: 0.76rem;
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
    flex-wrap: wrap;
  }
  .actions form {
    margin: 0;
  }
</style>
