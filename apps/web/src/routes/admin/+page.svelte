<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The dashboard: a grid of stat cards summarising users, content, reports, and
   * groups. `data.stats` is null when the caller lacks `dashboard.view` (or the
   * fetch failed), in which case we show a short note instead of empty zeros.
   */
  let { data } = $props();
  const s = $derived(data.stats);
</script>

{#if !s}
  <p class="faint">No dashboard access, or stats are unavailable right now.</p>
{:else}
  <div class="grid">
    <div class="card stat">
      <span class="num">{s.users.total}</span>
      <span class="lbl">total users</span>
      <span class="sub faint">{s.users.newLast7d} new this week</span>
    </div>
    <div class="card stat">
      <span class="num">{s.users.active}</span>
      <span class="lbl">active</span>
      <span class="sub faint">{s.users.suspended} suspended · {s.users.banned} banned</span>
    </div>
    <div class="card stat">
      <span class="num">{s.posts.total}</span>
      <span class="lbl">posts</span>
      <span class="sub faint">{s.posts.removed} removed by mods</span>
    </div>
    <div class="card stat">
      <span class="num" class:warn={s.reports.open > 0}>{s.reports.open}</span>
      <span class="lbl">open reports</span>
      <span class="sub faint">{s.groups.total} groups</span>
    </div>
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: var(--space-3);
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-4);
  }
  .num {
    font-family: var(--mono);
    font-size: 2rem;
    font-weight: 600;
    line-height: 1;
  }
  .num.warn {
    color: var(--color-danger);
  }
  .lbl {
    font-size: 0.85rem;
    color: var(--color-text-dim);
  }
  .sub {
    font-size: 0.74rem;
    margin-top: var(--space-2);
  }
</style>
