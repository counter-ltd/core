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
  import { enhance } from '$app/forms';
  import type { Permission } from '@counter/config';

  let { data, form } = $props();
  const s = $derived(data.stats);
  // data.permissions is merged in from the admin layout gate. The Discord card
  // is config-level, so it's only shown to groups.manage holders, matching the
  // API permission on the endpoint behind it.
  const canManage = $derived((data.permissions as Permission[]).includes('groups.manage'));
  // Disable the button while the action is in flight so a double-click can't fire
  // two registrations.
  let registering = $state(false);
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

{#if canManage}
  <section class="card discord">
    <div class="discord-head">
      <h2>Discord</h2>
      <p class="faint">
        Refresh Thing Two's slash commands (e.g. after adding <code>/create-app</code>).
        Idempotent; safe to re-run.
      </p>
    </div>
    <form
      method="POST"
      action="?/registerCommands"
      use:enhance={() => {
        registering = true;
        return async ({ update }) => {
          await update();
          registering = false;
        };
      }}
    >
      <button type="submit" disabled={registering}>
        {registering ? 'Registering…' : 'Re-register slash commands'}
      </button>
    </form>
    {#if form?.registered}
      <p class="ok">Registered ({form.scope}). Commands are live in Discord.</p>
    {:else if form?.error}
      <p class="err">{form.error}</p>
    {/if}
  </section>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: var(--space-3);
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-4) var(--space-4) var(--space-5);
    /* The accent rail down the left edge ties a flat grid of numbers back to the
       one signal colour without filling the whole card. */
    border-left: 2px solid var(--color-accent);
  }
  .num {
    font-family: var(--mono);
    font-size: 2.4rem;
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .num.warn {
    color: var(--color-danger);
  }
  /* An open-reports card with work waiting flips its rail red to match. */
  .stat:has(.num.warn) {
    border-left-color: var(--color-danger);
  }
  .lbl {
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.72rem;
    color: var(--color-text-dim);
    margin-top: var(--space-2);
  }
  .sub {
    font-size: 0.74rem;
    margin-top: var(--space-1);
  }
  .discord {
    margin-top: var(--space-5);
    padding: var(--space-4) var(--space-5) var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .discord-head h2 {
    font-size: 1rem;
    margin: 0 0 var(--space-1);
  }
  .discord-head p {
    font-size: 0.8rem;
    margin: 0;
  }
  .discord code {
    font-family: var(--mono);
    font-size: 0.78em;
  }
  .discord button {
    align-self: flex-start;
    font-family: var(--mono);
    font-size: 0.8rem;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-2, 6px);
    background: transparent;
    color: var(--color-accent);
    cursor: pointer;
  }
  .discord button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .ok {
    font-size: 0.8rem;
    color: var(--color-accent);
    margin: 0;
  }
  .err {
    font-size: 0.8rem;
    color: var(--color-danger);
    margin: 0;
  }
</style>
