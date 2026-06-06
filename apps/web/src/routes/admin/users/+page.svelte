<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * User management: search/status filters, a multi-select table, and a
   * side panel for moderation actions. Selecting one user shows their full
   * control set; selecting several shows bulk actions (add to group, ban,
   * suspend). The table and panel live in a two-column grid so controls
   * never interrupt the list layout.
   *
   * Per-badge group removal fires from the row itself and is not affected
   * by the selection state. Password reset is single-user only.
   */
  import { enhance } from '$app/forms';
  import type { Permission } from '@counter/config';
  import type { AdminUserListItem } from '@counter/types';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Select from '$lib/components/Select.svelte';

  let { data, form } = $props();

  const perms = $derived(data.permissions as Permission[]);
  const can = (p: Permission) => perms.includes(p);

  const canModerate = $derived(
    can('users.manage_groups') ||
      can('users.ban') ||
      can('users.suspend') ||
      can('users.reset_password'),
  );

  let selectedIds = $state(new Set<string>());

  const allSelected = $derived(
    data.users.length > 0 &&
      data.users.every((u: AdminUserListItem) => selectedIds.has(u.id)),
  );
  const someSelected = $derived(selectedIds.size > 0 && !allSelected);

  function toggleAll() {
    selectedIds = allSelected
      ? new Set()
      : new Set(data.users.map((u: AdminUserListItem) => u.id));
  }

  function toggleUser(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
  }

  const selected = $derived(
    data.users.filter((u: AdminUserListItem) => selectedIds.has(u.id)),
  );
  // Only defined when exactly one user is selected — drives status-conditional controls.
  const solo = $derived<AdminUserListItem | null>(
    selected.length === 1 ? selected[0] : null,
  );

  const panelOpen = $derived(canModerate && selectedIds.size > 0);

  function statusTone(u: AdminUserListItem): string {
    if (u.status === 'banned') return 'banned';
    if (u.status === 'suspended') return 'suspended';
    return 'active';
  }

  // Clear selection after any bulk action succeeds so the panel closes and
  // the table re-reads updated state.
  function onAction() {
    return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
      await update();
      if (result.type === 'success') selectedIds = new Set();
    };
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
  <Select
    name="status"
    aria-label="Filter by status"
    value={data.status}
    options={[
      {value: '', label: 'any status'},
      {value: 'active', label: 'active'},
      {value: 'suspended', label: 'suspended'},
      {value: 'banned', label: 'banned'},
    ]}
  />
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
{:else}
  <div class="workspace" class:has-panel={panelOpen}>
    <div class="table-wrap card">
      <table class="utable">
        <thead>
          <tr>
            {#if canModerate}
              <th class="cb-col">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onchange={toggleAll}
                  aria-label="Select all"
                />
              </th>
            {/if}
            <th>User</th>
            <th>Status</th>
            <th>Groups</th>
          </tr>
        </thead>
        <tbody>
          {#each data.users as u (u.id)}
            <tr class="urow" class:selected={selectedIds.has(u.id)}>
              {#if canModerate}
                <td class="cb-col">
                  <Checkbox
                    checked={selectedIds.has(u.id)}
                    onchange={() => toggleUser(u.id)}
                    aria-label="Select {u.username}"
                  />
                </td>
              {/if}
              <td class="user">
                <div class="who">
                  <a href="/{u.username}"><strong>{u.displayName || u.username}</strong></a>
                  <small class="faint">@{u.username}</small>
                </div>
              </td>
              <td>
                <span class="badge tone-{statusTone(u)}">{u.status}</span>
                {#if u.suspendedUntil && u.status === 'suspended'}
                  <small class="faint until">
                    until {new Date(u.suspendedUntil).toLocaleString()}
                  </small>
                {/if}
              </td>
              <td>
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
                  {:else}
                    <span class="faint none">—</span>
                  {/each}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if panelOpen}
      <aside class="side-panel card">
        <div class="panel-head">
          <div class="panel-who">
            {#if solo}
              <strong>{solo.displayName || solo.username}</strong>
              <small class="faint">@{solo.username}</small>
            {:else}
              <strong>{selectedIds.size} selected</strong>
              <small class="faint">bulk actions apply to all</small>
            {/if}
          </div>
          <button
            class="x-btn"
            onclick={() => (selectedIds = new Set())}
            aria-label="Close panel"
          >×</button>
        </div>

        <div class="panel-body">
          {#if can('users.manage_groups') && data.groups.length > 0}
            <section class="action-section">
              <p class="section-label">groups</p>
              <form method="POST" action="?/addGroup" use:enhance={onAction}>
                {#each [...selectedIds] as id}
                  <input type="hidden" name="userId" value={id} />
                {/each}
                <Select
                  name="groupId"
                  aria-label="Group to add"
                  options={[{value: '', label: 'choose group…'}, ...data.groups.map(g => ({value: g.id, label: g.name}))]}
                />
                <button class="btn" type="submit">add to group</button>
              </form>
            </section>
          {/if}

          {#if can('users.ban')}
            <section class="action-section">
              <p class="section-label">ban</p>
              <!-- Unban only shows for a single selected user whose status is 'banned',
                   since "unban all" over a mixed selection would silently skip active users. -->
              {#if solo && solo.status === 'banned'}
                <form method="POST" action="?/unban" use:enhance={onAction}>
                  <input type="hidden" name="userId" value={solo.id} />
                  <button class="btn" type="submit">lift ban</button>
                </form>
              {:else}
                <form method="POST" action="?/ban" use:enhance={onAction}>
                  {#each [...selectedIds] as id}
                    <input type="hidden" name="userId" value={id} />
                  {/each}
                  <input type="text" name="reason" placeholder="reason (optional)" />
                  <button class="btn btn-danger" type="submit">ban</button>
                </form>
              {/if}
            </section>
          {/if}

          {#if can('users.suspend')}
            <section class="action-section">
              <p class="section-label">suspend</p>
              <!-- Same single-user guard as unban: unsuspend only appears when we
                   know the selection is one suspended user. -->
              {#if solo && solo.status === 'suspended'}
                <form method="POST" action="?/unsuspend" use:enhance={onAction}>
                  <input type="hidden" name="userId" value={solo.id} />
                  <button class="btn" type="submit">end suspension</button>
                </form>
              {:else}
                <form method="POST" action="?/suspend" use:enhance={onAction}>
                  {#each [...selectedIds] as id}
                    <input type="hidden" name="userId" value={id} />
                  {/each}
                  <input type="datetime-local" name="until" aria-label="Suspend until" />
                  <input type="text" name="reason" placeholder="reason (optional)" />
                  <button class="btn btn-danger" type="submit">suspend</button>
                </form>
              {/if}
            </section>
          {/if}

          {#if can('users.reset_password') && solo}
            <section class="action-section">
              <p class="section-label">password reset</p>
              <form method="POST" action="?/resetPassword" use:enhance>
                <input type="hidden" name="userId" value={solo.id} />
                <input type="hidden" name="delivery" value="email" />
                <button class="btn" type="submit">email reset link</button>
              </form>
              <form method="POST" action="?/resetPassword" use:enhance>
                <input type="hidden" name="userId" value={solo.id} />
                <input type="hidden" name="delivery" value="link" />
                <button class="btn" type="submit">generate link</button>
              </form>
            </section>
          {/if}
        </div>
      </aside>
    {/if}
  </div>
{/if}

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

  .workspace {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    align-items: start;
  }
  .workspace.has-panel {
    grid-template-columns: 1fr 300px;
  }

  /* The card frames the table; rows draw their own dividers edge to edge. */
  .table-wrap {
    overflow-x: auto;
  }
  .utable {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  thead th {
    text-align: left;
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.66rem;
    font-weight: 500;
    color: var(--color-text-faint);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    white-space: nowrap;
  }
  .cb-col {
    width: 36px;
    padding-right: 0 !important;
  }
  .urow > td {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    vertical-align: middle;
  }
  .urow:hover > td {
    background: var(--color-surface-strong);
  }
  .urow.selected > td {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
  tbody tr:last-child > td {
    border-bottom: none;
  }

  .who {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }
  .who strong {
    font-weight: 600;
  }
  .until {
    margin-left: var(--space-2);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--mono);
    font-size: 0.7rem;
    padding: 2px 9px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border);
    color: var(--color-text-dim);
    white-space: nowrap;
  }
  /* A status dot ahead of the word so state reads at a glance before the label. */
  .badge::before {
    content: '';
    width: 5px;
    height: 5px;
    border-radius: var(--radius-pill);
    background: currentColor;
  }
  .tone-active {
    color: var(--color-repost);
    border-color: color-mix(in srgb, var(--color-repost) 50%, transparent);
  }
  .tone-banned {
    color: var(--color-danger);
    border-color: var(--color-danger);
  }
  .tone-suspended {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }

  .groups {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  .none {
    font-family: var(--mono);
  }
  .gbadge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.72rem;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--g) 55%, transparent);
    background: color-mix(in srgb, var(--g) 12%, transparent);
    color: var(--g);
    white-space: nowrap;
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

  /* Side panel */
  .side-panel {
    position: sticky;
    top: var(--space-4);
  }
  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }
  .panel-who {
    display: flex;
    flex-direction: column;
    gap: 2px;
    line-height: 1.3;
  }
  .x-btn {
    background: none;
    border: none;
    color: var(--color-text-faint);
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
    padding: 2px 4px;
    flex-shrink: 0;
  }
  .x-btn:hover {
    color: var(--color-text);
  }
  .panel-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4) var(--space-4);
  }
  .action-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .section-label {
    font-family: var(--mono);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-faint);
    margin: 0;
  }
  /* Stack inputs and button vertically so nothing fights for horizontal space. */
  .action-section form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
  }
  .action-section form input,
  .action-section form :global(.select) {
    width: 100%;
  }

  .reset-link {
    margin-bottom: var(--space-4);
    padding: var(--space-4);
    border-left: 2px solid var(--color-accent);
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
