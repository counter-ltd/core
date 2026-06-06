<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Group management: a table of existing groups with a side panel for
   * creating and editing. Clicking "+ new group" or "edit" on a row opens
   * the panel on the right; the table stays visible so context is never lost.
   * System groups protect their slug and hide the delete button.
   */
  import { enhance } from '$app/forms';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import { PERMISSION_KEYS, PERMISSION_META } from '@counter/config';
  import type { Permission } from '@counter/config';

  let { data, form } = $props();

  const perms = $derived(data.permissions as Permission[]);
  const canManage = $derived(perms.includes('groups.manage'));

  // Group the flat permission list by category heading, preserving declared
  // order, so the checklist renders as labelled sections.
  const categories = (() => {
    const out: Array<{ name: string; keys: Permission[] }> = [];
    for (const key of PERMISSION_KEYS) {
      const cat = PERMISSION_META[key].category;
      let section = out.find((s) => s.name === cat);
      if (!section) {
        section = { name: cat, keys: [] };
        out.push(section);
      }
      section.keys.push(key);
    }
    return out;
  })();

  // 'create' opens the new-group form; an id string opens that group's editor.
  type PanelMode = 'create' | string | null;
  let panel = $state<PanelMode>(null);

  const editingGroup = $derived(
    panel && panel !== 'create' ? data.groups.find((g: { id: string }) => g.id === panel) : null,
  );

  const panelOpen = $derived(panel !== null);

  // Close panel and reset after a successful write so the table reflects
  // updated state and the editor doesn't hold stale values.
  function onAction() {
    return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
      await update();
      if (result.type === 'success') panel = null;
    };
  }
</script>

{#if form?.error}<p class="error">{form.error}</p>{/if}
{#if form?.saved}<p class="ok">Saved.</p>{/if}

<div class="workspace" class:has-panel={panelOpen}>
  <div>
    {#if canManage}
      <div class="topbar">
        <button
          class="btn btn-primary"
          onclick={() => (panel = panel === 'create' ? null : 'create')}
        >
          {panel === 'create' ? 'cancel' : '+ new group'}
        </button>
      </div>
    {/if}

    <div class="table-wrap card">
      <table class="gtable">
        <thead>
          <tr>
            <th>Group</th>
            <th>Slug</th>
            <th>Type</th>
            <th class="num">Members · Perms</th>
            {#if canManage}<th class="right">Actions</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each data.groups as g (g.id)}
            <tr class="grow" class:selected={panel === g.id}>
              <td class="group">
                <span class="gname" style:--g={g.color ?? 'var(--color-accent)'}>{g.name}</span>
                {#if g.description}<p class="desc faint">{g.description}</p>{/if}
              </td>
              <td><code class="slug">{g.slug}</code></td>
              <td>
                {#if g.isSystem}
                  <span class="sys">system</span>
                {:else}
                  <span class="faint custom">custom</span>
                {/if}
              </td>
              <td class="num">{g.memberCount} · {g.permissions.length}</td>
              {#if canManage}
                <td class="right">
                  <button
                    class="btn edit-toggle"
                    onclick={() => (panel = panel === g.id ? null : g.id)}
                  >
                    {panel === g.id ? 'close' : 'edit'}
                  </button>
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  {#if panelOpen}
    <aside class="side-panel card">
      <div class="panel-head">
        <strong>{panel === 'create' ? 'New group' : (editingGroup?.name ?? 'Edit group')}</strong>
        <button class="x-btn" onclick={() => (panel = null)} aria-label="Close panel">×</button>
      </div>

      {#if panel === 'create'}
        <form method="POST" action="?/create" use:enhance={onAction} class="editor">
          <div class="fields">
            <label>slug<input name="slug" placeholder="support" required /></label>
            <label>name<input name="name" placeholder="Support team" required /></label>
            <label>colour<input name="color" placeholder="#7aa2ff" /></label>
          </div>
          <label class="full">description<input name="description" placeholder="What this group is for" /></label>
          {#each categories as cat (cat.name)}
            <fieldset>
              <legend>{cat.name}</legend>
              {#each cat.keys as key (key)}
                <div class="perm">
                  <Checkbox name="permissions" value={key} />
                  <span>{PERMISSION_META[key].label}</span>
                  <small class="faint">{PERMISSION_META[key].description}</small>
                </div>
              {/each}
            </fieldset>
          {/each}
          <button class="btn btn-primary" type="submit">create group</button>
        </form>

      {:else if editingGroup}
        <form method="POST" action="?/update" use:enhance={onAction} class="editor">
          <input type="hidden" name="groupId" value={editingGroup.id} />
          <div class="fields">
            <label>name<input name="name" value={editingGroup.name} /></label>
            <label>colour<input name="color" value={editingGroup.color ?? ''} /></label>
          </div>
          <label class="full">
            description<input name="description" value={editingGroup.description ?? ''} />
          </label>
          {#each categories as cat (cat.name)}
            <fieldset>
              <legend>{cat.name}</legend>
              {#each cat.keys as key (key)}
                <div class="perm">
                  <Checkbox
                    name="permissions"
                    value={key}
                    checked={editingGroup.permissions.includes(key)}
                  />
                  <span>{PERMISSION_META[key].label}</span>
                  <small class="faint">{PERMISSION_META[key].description}</small>
                </div>
              {/each}
            </fieldset>
          {/each}
          <div class="editor-actions">
            <button class="btn btn-primary" type="submit">save</button>
            {#if !editingGroup.isSystem}
              <button
                class="btn btn-danger"
                type="submit"
                formaction="?/remove"
                onclick={(e) => {
                  if (!confirm(`Delete group "${editingGroup.name}"? This removes it from everyone in it.`))
                    e.preventDefault();
                }}
              >
                delete
              </button>
            {/if}
          </div>
        </form>
      {/if}
    </aside>
  {/if}
</div>

<style>
  .workspace {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    align-items: start;
  }
  .workspace.has-panel {
    grid-template-columns: 1fr 320px;
  }

  .topbar {
    margin-bottom: var(--space-3);
  }

  /* The card frames the table; rows draw their own dividers edge to edge. */
  .table-wrap {
    overflow-x: auto;
  }
  .gtable {
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
  .right {
    text-align: right;
  }
  .num {
    text-align: right;
    font-family: var(--mono);
    white-space: nowrap;
  }
  .grow > td {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    vertical-align: top;
  }
  .grow:hover > td {
    background: var(--color-surface-strong);
  }
  .grow.selected > td {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
  tbody tr:last-child > td {
    border-bottom: none;
  }

  .gname {
    font-weight: 600;
    font-size: 1rem;
    color: var(--g);
    /* A short colour swatch ahead of the name shows the group accent even
       when the text colour is too dark to read it off the label alone. */
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .gname::before {
    content: '';
    width: 9px;
    height: 9px;
    border-radius: var(--radius-pill);
    background: var(--g);
  }
  .desc {
    font-size: 0.8rem;
    margin: var(--space-1) 0 0;
    max-width: 42ch;
  }
  .slug {
    font-family: var(--mono);
    font-size: 0.78rem;
    color: var(--color-text-dim);
  }
  .sys,
  .custom {
    font-family: var(--mono);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sys {
    padding: 1px 6px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-pill);
    color: var(--color-text-dim);
  }
  .edit-toggle {
    white-space: nowrap;
  }

  /* Side panel */
  .side-panel {
    position: sticky;
    top: var(--space-4);
    max-height: calc(100vh - var(--space-8, 4rem));
    overflow-y: auto;
  }
  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    position: sticky;
    top: 0;
    background: var(--color-surface);
    z-index: 1;
  }
  .x-btn {
    background: none;
    border: none;
    color: var(--color-text-faint);
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
    padding: 2px 4px;
  }
  .x-btn:hover {
    color: var(--color-text);
  }

  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-4);
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .fields label,
  .full {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.78rem;
    color: var(--color-text-dim);
  }
  fieldset {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: var(--space-3);
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  legend {
    font-family: var(--mono);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-faint);
    padding: 0 var(--space-2);
  }
  .perm {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 0 var(--space-2);
    font-size: 0.84rem;
  }
  .perm small {
    grid-column: 2;
    font-size: 0.72rem;
  }
  .editor-actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
</style>
