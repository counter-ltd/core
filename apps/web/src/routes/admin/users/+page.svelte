<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The user management table: search, status filter, group badges, and the
   * moderation controls (assign/remove group, ban, suspend). Which controls show
   * is driven by `data.permissions`, so a moderator with only `users.view` sees a
   * read-only list while an admin sees the full set of actions.
   *
   * Each control is its own small form posting to a named action in the server
   * file, wrapped in use:enhance so an action runs without a full reload and the
   * filter/scroll position survive.
   */
  import { enhance } from '$app/forms';
  import type { Permission } from '@counter/config';
  import type { AdminUserListItem } from '@counter/types';

  let { data, form } = $props();

  const perms = $derived(data.permissions as Permission[]);
  const can = (p: Permission) => perms.includes(p);

  // Tracks which row has its moderation drawer open, by user id.
  let openRow = $state<string | null>(null);
  const toggle = (id: string) => (openRow = openRow === id ? null : id);

  /** Short status badge text and tone for a user row. */
  function statusTone(u: AdminUserListItem): string {
    if (u.status === 'banned') return 'banned';
    if (u.status === 'suspended') return 'suspended';
    return 'active';
  }
</script>

<form method="GET" class="filters">
  <input
    type="search"
    name="q"
    placeholder="search username or name"
    value={data.q}
    aria-label="Search users"
  />
  <select name="status" aria-label="Filter by status">
    <option value="" selected={data.status === ''}>any status</option>
    <option value="active" selected={data.status === 'active'}>active</option>
    <option value="suspended" selected={data.status === 'suspended'}>suspended</option>
    <option value="banned" selected={data.status === 'banned'}>banned</option>
  </select>
  <button class="btn" type="submit">filter</button>
</form>

{#if form?.error}<p class="error">{form.error}</p>{/if}
{#if form?.saved && !form?.resetLink}<p class="ok">Done.</p>{/if}
{#if form?.resetLink}
  <div class="reset-link card">
    <p>Reset link generated. It's good for one hour; hand it over securely.</p>
    <input type="text" readonly value={form.resetLink} aria-label="Password reset link" />
  </div>
{/if}

{#if data.users.length === 0}
  <p class="faint">No users match.</p>
{/if}

<ul class="rows">
  {#each data.users as u (u.id)}
    <li class="card row">
      <div class="head">
        <div class="who">
          <a href="/{u.username}"><strong>{u.displayName || u.username}</strong></a>
          <small class="faint">@{u.username}</small>
        </div>
        <span class="badge tone-{statusTone(u)}">{u.status}</span>
        {#if u.suspendedUntil && u.status === 'suspended'}
          <small class="faint">until {new Date(u.suspendedUntil).toLocaleString()}</small>
        {/if}
        <div class="groups">
          {#each u.groups as g (g.id)}
            <span class="gbadge" style:--g={g.color ?? 'var(--color-accent)'}>
              {g.name}
              {#if can('users.manage_groups')}
                <form method="POST" action="?/removeGroup" use:enhance>
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="groupId" value={g.id} />
                  <button class="x" type="submit" aria-label="Remove from {g.name}">×</button>
                </form>
              {/if}
            </span>
          {/each}
        </div>
        {#if can('users.manage_groups') || can('users.ban') || can('users.suspend') || can('users.reset_password')}
          <button class="btn mod-toggle" onclick={() => toggle(u.id)}>
            {openRow === u.id ? 'close' : 'manage'}
          </button>
        {/if}
      </div>

      {#if openRow === u.id}
        <div class="drawer">
          {#if can('users.manage_groups') && data.groups.length > 0}
            <form method="POST" action="?/addGroup" use:enhance class="line">
              <input type="hidden" name="userId" value={u.id} />
              <select name="groupId" aria-label="Group to add">
                <option value="">add to group…</option>
                {#each data.groups as g (g.id)}
                  <option value={g.id}>{g.name}</option>
                {/each}
              </select>
              <button class="btn" type="submit">add</button>
            </form>
          {/if}

          {#if can('users.ban')}
            {#if u.status === 'banned'}
              <form method="POST" action="?/unban" use:enhance class="line">
                <input type="hidden" name="userId" value={u.id} />
                <button class="btn" type="submit">lift ban</button>
              </form>
            {:else}
              <form method="POST" action="?/ban" use:enhance class="line">
                <input type="hidden" name="userId" value={u.id} />
                <input type="text" name="reason" placeholder="ban reason (optional)" />
                <button class="btn btn-danger" type="submit">ban</button>
              </form>
            {/if}
          {/if}

          {#if can('users.suspend')}
            {#if u.status === 'suspended'}
              <form method="POST" action="?/unsuspend" use:enhance class="line">
                <input type="hidden" name="userId" value={u.id} />
                <button class="btn" type="submit">end suspension</button>
              </form>
            {:else}
              <form method="POST" action="?/suspend" use:enhance class="line">
                <input type="hidden" name="userId" value={u.id} />
                <input type="datetime-local" name="until" aria-label="Suspend until" />
                <input type="text" name="reason" placeholder="reason (optional)" />
                <button class="btn btn-danger" type="submit">suspend</button>
              </form>
            {/if}
          {/if}

          {#if can('users.reset_password')}
            <div class="line">
              <form method="POST" action="?/resetPassword" use:enhance>
                <input type="hidden" name="userId" value={u.id} />
                <input type="hidden" name="delivery" value="email" />
                <button class="btn" type="submit">email reset link</button>
              </form>
              <form method="POST" action="?/resetPassword" use:enhance>
                <input type="hidden" name="userId" value={u.id} />
                <input type="hidden" name="delivery" value="link" />
                <button class="btn" type="submit">generate link</button>
              </form>
            </div>
          {/if}
        </div>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .filters {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
    flex-wrap: wrap;
  }
  .filters input[type='search'] {
    flex: 1;
    min-width: 160px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row {
    padding: var(--space-3);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .who {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }
  .badge {
    font-family: var(--mono);
    font-size: 0.7rem;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border);
  }
  .tone-banned {
    color: var(--color-danger);
    border-color: var(--color-danger);
  }
  .tone-suspended {
    color: #e0a23a;
    border-color: #e0a23a;
  }
  .groups {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  .gbadge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.72rem;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--g);
    color: var(--g);
  }
  .gbadge form {
    margin: 0;
    display: inline;
  }
  .x {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 0.9rem;
    line-height: 1;
    padding: 0;
  }
  .mod-toggle {
    margin-left: auto;
  }
  .drawer {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .line {
    display: flex;
    gap: var(--space-2);
    margin: 0;
    flex-wrap: wrap;
  }
  .line input[type='text'] {
    flex: 1;
    min-width: 140px;
  }
  .btn-danger {
    color: var(--color-danger);
    border-color: var(--color-danger);
  }
  .reset-link {
    margin-bottom: var(--space-4);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .reset-link p {
    margin: 0;
    font-size: 0.85rem;
    color: var(--color-text-dim);
  }
  .reset-link input {
    width: 100%;
    font-family: var(--mono);
    font-size: 0.8rem;
  }
</style>
