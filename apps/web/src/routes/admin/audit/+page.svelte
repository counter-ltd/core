<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The audit trail: a flat, newest-first list of admin actions. Each line shows
   * the action tag, a human summary, the actor, and a timestamp. It's deliberately
   * plain and read-only, since the value of an audit log is that nothing here can
   * be edited from the UI.
   */
  let { data } = $props();
</script>

{#if data.entries.length === 0}
  <p class="faint">No admin actions logged yet.</p>
{/if}

<ul class="log card">
  {#each data.entries as e (e.id)}
    <li class="line">
      <code class="action">{e.action}</code>
      <span class="summary">{e.summary}</span>
      <small class="faint by">{e.actor ? `@${e.actor.username}` : 'system'}</small>
      <small class="faint when">{new Date(e.createdAt).toLocaleString()}</small>
    </li>
  {/each}
</ul>

<style>
  .log {
    list-style: none;
    margin: 0;
    /* The card draws the frame; rows handle their own dividers, so kill the
       list's own padding and let lines run edge to edge. */
    padding: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .line {
    display: grid;
    grid-template-columns: minmax(120px, auto) 1fr auto;
    align-items: baseline;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    transition: background 0.1s ease;
  }
  .line:last-child {
    border-bottom: none;
  }
  .line:hover {
    background: var(--color-surface-strong);
  }
  .action {
    font-family: var(--mono);
    font-size: 0.74rem;
    color: var(--color-accent);
  }
  .summary {
    font-size: 0.86rem;
  }
  .by {
    font-family: var(--mono);
    font-size: 0.74rem;
  }
  .when {
    grid-column: 2 / 4;
    font-size: 0.72rem;
  }
  @media (min-width: 600px) {
    .when {
      grid-column: auto;
      text-align: right;
    }
  }
</style>
