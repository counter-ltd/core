<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Group management: a create form plus one editable card per existing group.
   * Each card exposes the group's metadata and a permission checklist built from
   * the shared catalogue, with the group's current permissions pre-ticked. System
   * groups keep their slug and can't be deleted, so those controls are withheld
   * for them. All write controls are gated on `groups.manage`.
   */
  import { enhance } from '$app/forms';
  import { PERMISSION_KEYS, PERMISSION_META } from '@counter/config';
  import type { Permission } from '@counter/config';

  let { data, form } = $props();

  const perms = $derived(data.permissions as Permission[]);
  const canManage = $derived(perms.includes('groups.manage'));

  // Group the flat permission list by its category heading, preserving the
  // declared order, so the checklist renders as labelled sections.
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

  // Which group card has its editor expanded.
  let editing = $state<string | null>(null);
  // Whether the create form is showing.
  let creating = $state(false);
</script>

{#if form?.error}<p class="error">{form.error}</p>{/if}
{#if form?.saved}<p class="ok">Saved.</p>{/if}

{#if canManage}
  <div class="topbar">
    <button class="btn btn-primary" onclick={() => (creating = !creating)}>
      {creating ? 'cancel' : '+ new group'}
    </button>
  </div>

  {#if creating}
    <form method="POST" action="?/create" use:enhance class="card editor">
      <h3>New group</h3>
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
            <label class="perm">
              <input type="checkbox" name="permissions" value={key} />
              <span>{PERMISSION_META[key].label}</span>
              <small class="faint">{PERMISSION_META[key].description}</small>
            </label>
          {/each}
        </fieldset>
      {/each}
      <button class="btn btn-primary" type="submit">create group</button>
    </form>
  {/if}
{/if}

<ul class="rows">
  {#each data.groups as g (g.id)}
    <li class="card group">
      <div class="head">
        <span class="gname" style:--g={g.color ?? 'var(--color-accent)'}>{g.name}</span>
        <code class="slug">{g.slug}</code>
        {#if g.isSystem}<span class="sys">system</span>{/if}
        <small class="faint">{g.memberCount} member{g.memberCount === 1 ? '' : 's'} · {g.permissions.length} perms</small>
        {#if canManage}
          <button class="btn edit-toggle" onclick={() => (editing = editing === g.id ? null : g.id)}>
            {editing === g.id ? 'close' : 'edit'}
          </button>
        {/if}
      </div>
      {#if g.description}<p class="desc faint">{g.description}</p>{/if}

      {#if canManage && editing === g.id}
        <form method="POST" action="?/update" use:enhance class="editor">
          <input type="hidden" name="groupId" value={g.id} />
          <div class="fields">
            <label>name<input name="name" value={g.name} /></label>
            <label>colour<input name="color" value={g.color ?? ''} /></label>
          </div>
          <label class="full">description<input name="description" value={g.description ?? ''} /></label>
          {#each categories as cat (cat.name)}
            <fieldset>
              <legend>{cat.name}</legend>
              {#each cat.keys as key (key)}
                <label class="perm">
                  <input
                    type="checkbox"
                    name="permissions"
                    value={key}
                    checked={g.permissions.includes(key)}
                  />
                  <span>{PERMISSION_META[key].label}</span>
                  <small class="faint">{PERMISSION_META[key].description}</small>
                </label>
              {/each}
            </fieldset>
          {/each}
          <div class="editor-actions">
            <button class="btn btn-primary" type="submit">save</button>
            {#if !g.isSystem}
              <button
                class="btn btn-danger"
                type="submit"
                formaction="?/remove"
                onclick={(e) => {
                  if (!confirm(`Delete group "${g.name}"? This removes it from everyone in it.`))
                    e.preventDefault();
                }}
              >
                delete
              </button>
            {/if}
          </div>
        </form>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .topbar {
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
  .group {
    padding: var(--space-3);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .gname {
    font-weight: 600;
    color: var(--g);
  }
  .slug {
    font-family: var(--mono);
    font-size: 0.74rem;
    color: var(--color-text-dim);
  }
  .sys {
    font-family: var(--mono);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 1px 6px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-pill);
    color: var(--color-text-dim);
  }
  .edit-toggle {
    margin-left: auto;
  }
  .desc {
    font-size: 0.82rem;
    margin: var(--space-2) 0 0;
  }
  .editor {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .fields {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .fields label,
  .full {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.78rem;
    color: var(--color-text-dim);
    flex: 1;
    min-width: 120px;
  }
  fieldset {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  legend {
    font-family: var(--mono);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-dim);
    padding: 0 var(--space-2);
  }
  .perm {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
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
  }
  .btn-danger {
    color: var(--color-danger);
    border-color: var(--color-danger);
  }
</style>
