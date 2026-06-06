<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The themes page: three tabs over one route.
   *
   *   Library  your own themes plus the ones you've saved (signed-in only).
   *   Browse   every published community theme, with a Save action.
   *   Create   a live editor: drag the colour pickers and an example post
   *            recolours in real time, then save as a draft or publish.
   *
   * A theme is just a bag of CSS variable overrides, so applying one is a pure
   * client action: we push the variables onto the document root and remember the
   * choice per-device. What the server tracks is membership (own + saved), not
   * which theme is active, which is why apply/reset never hit the network.
   */
  import { enhance } from '$app/forms';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Select from '$lib/components/Select.svelte';
  import {
    applyTheme,
    previewVars,
    expandThemeVars,
    defaultThemeVars,
    canonicalVarsFrom,
    THEME_COLOR_TOKENS,
    THEME_STYLE_CONTROLS,
    THEME_STORAGE_KEY,
    type StyleControl,
    type StyleGroup,
  } from '$lib/theme';
  import type { Theme, ThemeVariables } from '@counter/types';
  let { data, form } = $props();

  type Tab = 'library' | 'browse' | 'create';
  // Land signed-in users on their Library; everyone else starts in Browse, the
  // only tab with content for them.
  let tab = $state<Tab>(data.user ? 'library' : 'browse');

  // Which theme is currently applied, so the matching card can show "Applied".
  // Local UI state only; it isn't read back from anywhere on load.
  let active = $state<string | null>(null);

  // Ids already in the Library, so Browse can hide Save on themes you've got.
  const savedIds = $derived(
    new Set([...data.library.created, ...data.library.saved].map((t) => t.id)),
  );

  // Apply a theme: push its variables to the DOM now, mark it active, and save
  // it so the layout can re-apply it on the next visit.
  function use(theme: Theme) {
    applyTheme(theme.variables);
    active = theme.id;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme.variables));
    } catch {
      // Private-mode or full storage: the theme still applies for this session,
      // it just won't persist. Not worth interrupting the user over.
    }
  }

  // Back to the built-in defaults: applyTheme(null) strips the overrides and we
  // forget the saved choice.
  function reset() {
    applyTheme(null);
    active = null;
    try {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // Same as use(): a storage failure here is harmless.
    }
  }

  // Pull the four headline colours for a card's preview swatches, skipping any
  // a theme happens to leave undefined.
  function swatches(v: ThemeVariables): string[] {
    return ['--color-bg', '--color-accent', '--color-accent-2', '--color-text']
      .map((k) => v[k])
      .filter((c): c is string => !!c);
  }

  // --- Create editor state ---

  // The working variable map for the editor: every colour and style knob the
  // user can set, seeded from the defaults so a fresh theme opens on the current
  // look. Widgets bind straight into this, and expandThemeVars() turns the
  // canonical knobs into the full set the preview and the saved theme use.
  let vars = $state<Record<string, string>>(defaultThemeVars());
  // Name and description are controlled too, so loading a theme into the editor
  // can prefill them.
  let name = $state('');
  let description = $state('');
  // The id of the theme being edited, or null when creating a fresh one. Drives
  // which form action runs and the editor's heading.
  let editingId = $state<string | null>(null);

  // The expanded map (canonical knobs plus derived tokens) for the live preview.
  const previewStyle = $derived(previewVars(expandThemeVars(vars)));

  // Reset the editor to a blank, default theme.
  function newTheme() {
    editingId = null;
    name = '';
    description = '';
    vars = defaultThemeVars();
  }

  // Load one of your themes into the editor and switch to Create. Only the
  // canonical knobs are read back; the derived tokens get recomputed on save.
  function startEdit(theme: Theme) {
    editingId = theme.id;
    name = theme.name;
    description = theme.description ?? '';
    vars = canonicalVarsFrom(theme.variables);
    // A colour input can't show rgba/named values, so swap any non-hex stored
    // colour for its default rather than render the picker as black.
    for (const t of THEME_COLOR_TOKENS) {
      if (!/^#[0-9a-f]{6}$/i.test(vars[t.key] ?? '')) vars[t.key] = t.default;
    }
    tab = 'create';
  }

  // --- Style control widgets ---

  const STYLE_GROUPS: { id: StyleGroup; label: string }[] = [
    { id: 'type', label: 'Type' },
    { id: 'shape', label: 'Shape' },
    { id: 'surface', label: 'Surface' },
  ];

  // A range stores its value as a CSS string ("12px"); the slider works in the
  // raw number, so parse on read and re-attach the unit on write.
  function rangeValue(c: Extract<StyleControl, { kind: 'range' }>): number {
    return parseFloat(vars[c.key] ?? c.default) || 0;
  }
  function setRange(c: Extract<StyleControl, { kind: 'range' }>, n: number) {
    vars[c.key] = c.unit ? `${n}${c.unit}` : `${n}`;
  }
</script>

<svelte:head><title>Themes · Counter</title></svelte:head>

<div class="spread head">
  <div>
    <h1 class="title">Themes</h1>
    <p class="muted sub">Themes are just CSS variable overrides. Apply one instantly — it's saved on this device.</p>
  </div>
  <button class="btn" onclick={reset}>Default</button>
</div>

<!-- Tab bar. Create is members-only (it posts a draft), so it's hidden when
     logged out, same as the per-card Save/Delete actions below. -->
<nav class="tabs" aria-label="Theme sections">
  <button class="tab" class:on={tab === 'library'} onclick={() => (tab = 'library')}>Library</button>
  <button class="tab" class:on={tab === 'browse'} onclick={() => (tab = 'browse')}>Browse</button>
  {#if data.user}
    <button class="tab" class:on={tab === 'create'} onclick={() => (tab = 'create')}>Create</button>
  {/if}
</nav>

{#if form?.error}<p class="error tab-error">{form.error}</p>{/if}

<!-- ===== Library ===== -->
{#if tab === 'library'}
  {#if !data.user}
    <p class="muted">
      <a href="/login">Sign in</a> to keep a library of your own themes and ones you've saved.
    </p>
  {:else}
    <section class="lib">
      <h2 class="sec">Created by you</h2>
      <div class="grid">
        {#each data.library.created as theme (theme.id)}
          <div class="tcard panel" class:active={active === theme.id}>
            <div class="swatches">
              {#each swatches(theme.variables) as c, i (i)}<span class="sw" style="background:{c}"></span>{/each}
            </div>
            <strong>{theme.name}</strong>
            {#if theme.official}<span class="pill official">Official</span>{:else if !theme.published}<span class="pill draft">Draft</span>{/if}
            {#if theme.description}<p class="desc muted">{theme.description}</p>{/if}
            <div class="cardbtns">
              <button class="btn btn-primary apply" onclick={() => use(theme)}>
                {active === theme.id ? 'Applied' : 'Apply'}
              </button>
              <!-- Official themes are catalog-managed: no edit/delete, even for the owner. -->
              {#if !theme.official}
                <button class="btn" onclick={() => startEdit(theme)}>Edit</button>
                <form method="POST" action="?/delete" use:enhance>
                  <input type="hidden" name="id" value={theme.id} />
                  <button class="btn btn-ghost" type="submit">Delete</button>
                </form>
              {/if}
            </div>
          </div>
        {:else}
          <p class="muted">Nothing yet. Head to <button class="linkish" onclick={() => (tab = 'create')}>Create</button> to make one.</p>
        {/each}
      </div>

      <h2 class="sec">Saved</h2>
      <div class="grid">
        {#each data.library.saved as theme (theme.id)}
          <div class="tcard panel" class:active={active === theme.id}>
            <div class="swatches">
              {#each swatches(theme.variables) as c, i (i)}<span class="sw" style="background:{c}"></span>{/each}
            </div>
            <strong>{theme.name}</strong>
            {#if theme.description}<p class="desc muted">{theme.description}</p>{/if}
            {#if theme.author}<p class="by faint">by <a href="/{theme.author.username}">@{theme.author.username}</a></p>{/if}
            <div class="cardbtns">
              <button class="btn btn-primary apply" onclick={() => use(theme)}>
                {active === theme.id ? 'Applied' : 'Apply'}
              </button>
              <form method="POST" action="?/unsave" use:enhance>
                <input type="hidden" name="id" value={theme.id} />
                <button class="btn btn-ghost" type="submit">Unsave</button>
              </form>
            </div>
          </div>
        {:else}
          <p class="muted">Nothing saved. Find themes in <button class="linkish" onclick={() => (tab = 'browse')}>Browse</button>.</p>
        {/each}
      </div>
    </section>
  {/if}
{/if}

<!-- ===== Browse ===== -->
{#if tab === 'browse'}
  <div class="grid">
    {#each data.browse.data as theme (theme.id)}
      <div class="tcard panel" class:active={active === theme.id}>
        <div class="swatches">
          {#each swatches(theme.variables) as c, i (i)}<span class="sw" style="background:{c}"></span>{/each}
        </div>
        <strong>{theme.name}</strong>
        {#if theme.official}<span class="pill official">Official</span>{/if}
        {#if theme.description}<p class="desc muted">{theme.description}</p>{/if}
        {#if theme.author && !theme.official}<p class="by faint">by <a href="/{theme.author.username}">@{theme.author.username}</a></p>{/if}
        <div class="cardbtns">
          <button class="btn btn-primary apply" onclick={() => use(theme)}>
            {active === theme.id ? 'Applied' : 'Apply'}
          </button>
          {#if data.user && !savedIds.has(theme.id)}
            <form method="POST" action="?/save" use:enhance>
              <input type="hidden" name="id" value={theme.id} />
              <button class="btn" type="submit">Save</button>
            </form>
          {:else if data.user}
            <span class="pill saved">In library</span>
          {/if}
        </div>
      </div>
    {:else}
      <p class="muted">No themes published yet.</p>
    {/each}
  </div>
{/if}

<!-- ===== Create / Edit ===== -->
{#if tab === 'create' && data.user}
  <!-- One form drives both modes: editing posts to ?/update with the id, a fresh
       theme posts to ?/create. -->
  <form method="POST" action={editingId ? '?/update' : '?/create'} use:enhance class="creator">
    {#if editingId}<input type="hidden" name="id" value={editingId} />{/if}
    <!-- Left: the controls. Every widget mutates `vars`; the hidden inputs below
         serialize it for the POST, and the preview reacts the instant it changes. -->
    <div class="controls">
      {#if editingId}
        <div class="spread editing-bar">
          <span class="pill">Editing</span>
          <button type="button" class="linkish" onclick={newTheme}>Start new instead</button>
        </div>
      {/if}

      <div class="meta">
        <div>
          <label for="name">Name</label>
          <input id="name" name="name" required maxlength="80" placeholder="Midnight amber" bind:value={name} />
        </div>
        <div>
          <label for="description">Description <span class="faint">(optional)</span></label>
          <input id="description" name="description" maxlength="500" placeholder="What's the vibe?" bind:value={description} />
        </div>
      </div>

      <span class="grouplabel">Colours</span>
      <div class="swatch-grid">
        {#each THEME_COLOR_TOKENS as token (token.key)}
          <label class="cl">
            <span>{token.label}</span>
            <input type="color" bind:value={vars[token.key]} />
          </label>
        {/each}
      </div>

      <!-- Typography, geometry, and surface knobs, grouped. -->
      {#each STYLE_GROUPS as g (g.id)}
        <span class="grouplabel">{g.label}</span>
        <div class="style-grid">
          {#each THEME_STYLE_CONTROLS.filter((c) => c.group === g.id) as c (c.key)}
            <div class="ctl">
              <span class="ctl-label">{c.label}</span>
              {#if c.kind === 'select'}
                <Select bind:value={vars[c.key]} options={c.options} />
              {:else if c.kind === 'range'}
                <input
                  type="range"
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  value={rangeValue(c)}
                  oninput={(e) => setRange(c, +e.currentTarget.value)}
                />
                <span class="ctl-val">{vars[c.key]}</span>
              {:else}
                <Checkbox
                  checked={vars[c.key] !== c.off}
                  onchange={(e) => (vars[c.key] = (e.currentTarget as HTMLInputElement).checked ? c.on : c.off)}
                />
              {/if}
            </div>
          {/each}
        </div>
      {/each}

      <!-- Serialize the whole working map; the server re-expands it. -->
      {#each Object.entries(vars) as [k, v] (k)}
        <input type="hidden" name={k} value={v} />
      {/each}

      <div class="submit-row">
        <!-- The clicked button carries `published`, so the same form makes a
             private draft or a public theme depending on which you press. -->
        <button class="btn" type="submit" name="published" value="false">Save to library</button>
        <button class="btn btn-primary" type="submit" name="published" value="true">Publish</button>
      </div>
    </div>

    <!-- Right: a self-contained example. The wrapper sets the full expanded token
         map, so everything inside (colours, font, corners, glass) recolours live
         without touching the real page theme or the editor chrome. -->
    <div class="preview" style={previewStyle}>
      <p class="preview-label">Live preview</p>
      <div class="panel pv-post">
        <div class="pv-head">
          <div class="pv-avatar"></div>
          <div>
            <div class="pv-name">Ada Lovelace <span class="pv-handle">@ada</span></div>
            <div class="pv-time">2h</div>
          </div>
        </div>
        <p class="pv-body">A theme is more than colour now: font, corners, and glass too. Tweak and watch. <span class="pv-link">#counter</span></p>
        <div class="pv-actions">
          <span>reply 12</span>
          <span class="pv-repost">repost 4</span>
          <span class="pv-like">like 28</span>
          <span>views 1.2k</span>
        </div>
      </div>
      <div class="pv-row">
        <button class="btn" type="button" tabindex="-1">Secondary</button>
        <button class="btn btn-primary" type="button" tabindex="-1">Primary</button>
        <span class="pill">topic</span>
      </div>
      <input class="pv-input" type="text" value="An input field" readonly tabindex="-1" />
    </div>
  </form>
{/if}

<style>
  .head { align-items: flex-end; margin-bottom: var(--space-4); }
  .title { margin: 0; }
  .sub { margin: var(--space-1) 0 0; }

  .tabs { display: flex; gap: var(--space-2); border-bottom: 1px solid var(--color-border); margin-bottom: var(--space-4); }
  .tab {
    font-family: var(--mono);
    font-size: 0.82rem;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--color-text-dim);
    padding: var(--space-2) var(--space-1);
    margin-bottom: -1px;
    cursor: pointer;
  }
  .tab:hover { color: var(--color-text); }
  .tab.on { color: var(--color-accent); border-bottom-color: var(--color-accent); }
  .tab-error { margin: 0 0 var(--space-3); }

  .sec { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-faint); margin: var(--space-4) 0 var(--space-3); }
  .lib > .sec:first-child { margin-top: 0; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: var(--space-3);
  }
  .tcard { padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
  .tcard.active { border-color: var(--color-accent); }
  .swatches { display: flex; gap: 4px; margin-bottom: var(--space-2); }
  .sw { width: 26px; height: 26px; border-radius: 8px; border: 1px solid var(--color-border); }
  .desc { margin: 0; font-size: 0.86rem; }
  .by { margin: 0; font-size: 0.8rem; }
  .draft { align-self: flex-start; }
  .saved { align-self: center; }
  .official { align-self: flex-start; color: var(--color-accent); border-color: var(--color-accent); }
  .cardbtns { display: flex; align-items: center; gap: var(--space-2); margin-top: auto; padding-top: var(--space-2); }
  .apply { flex: 1; }

  /* Inline "go to other tab" prompts that read as links but drive tab state. */
  .linkish { background: none; border: none; padding: 0; font: inherit; color: var(--color-accent); cursor: pointer; }

  /* --- Create --- */
  .creator { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); align-items: start; }
  @media (max-width: 720px) { .creator { grid-template-columns: 1fr; } }

  .controls { display: flex; flex-direction: column; gap: var(--space-4); }
  .meta { display: flex; flex-direction: column; gap: var(--space-3); }
  .swatch-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--space-3); }
  .cl { display: flex; flex-direction: column; gap: 4px; font-size: 0.72rem; }
  .cl span { color: var(--color-text-dim); }
  .cl input[type='color'] { width: 100%; height: 34px; padding: 2px; cursor: pointer; }
  .submit-row { display: flex; gap: var(--space-3); flex-wrap: wrap; }
  .editing-bar { font-size: 0.8rem; }

  .grouplabel { font-family: var(--mono); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-faint); }

  .style-grid { display: flex; flex-direction: column; gap: var(--space-3); }
  .ctl { display: grid; grid-template-columns: 110px 1fr auto; align-items: center; gap: var(--space-3); }
  .ctl-label { font-size: 0.78rem; color: var(--color-text-dim); }
  .ctl-val { font-family: var(--mono); font-size: 0.72rem; color: var(--color-text-faint); min-width: 48px; text-align: right; }
  .ctl input[type='range'] { width: 100%; }
  .ctl :global(.checkbox) { justify-self: start; }
  .ctl :global(.select) { width: 100%; }

  /* The preview is sticky so it stays in view while scrolling the colour grid. */
  .preview {
    position: sticky;
    top: var(--space-4);
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    color: var(--color-text);
    /* Declare the themeable font/spacing here so the scoped --font override
       reaches the example. font-family inherits as a resolved value, so a
       child won't re-evaluate var(--font) unless an ancestor restates it. */
    font-family: var(--font);
    letter-spacing: var(--letter-spacing);
  }
  .preview-label { font-family: var(--mono); font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-faint); margin: 0; }

  /* No surface props here: the .panel class on the same element owns the fill,
     border, radius, blur, and shadow so the glass tokens drive the preview. */
  .pv-post { padding: var(--space-3); }
  .pv-head { display: flex; gap: var(--space-2); align-items: center; margin-bottom: var(--space-2); }
  .pv-avatar { width: 34px; height: 34px; border-radius: var(--radius-pill); background: var(--color-surface-strong); border: 1px solid var(--color-border-bright); flex: none; }
  .pv-name { font-size: 0.88rem; font-weight: 600; color: var(--color-text); }
  .pv-handle { font-family: var(--mono); font-weight: 400; color: var(--color-text-dim); font-size: 0.8rem; }
  .pv-time { font-family: var(--mono); font-size: 0.72rem; color: var(--color-text-faint); }
  .pv-body { margin: 0 0 var(--space-2); font-size: 0.9rem; color: var(--color-text); }
  .pv-link { color: var(--color-accent); }
  .pv-actions { display: flex; gap: var(--space-3); font-family: var(--mono); font-size: 0.72rem; color: var(--color-text-dim); }
  .pv-repost { color: var(--color-repost); }
  .pv-like { color: var(--color-like); }
  .pv-row { display: flex; align-items: center; gap: var(--space-2); }
  .pv-input { pointer-events: none; }
</style>
