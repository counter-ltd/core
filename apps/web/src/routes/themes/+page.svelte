<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The theme gallery. Browse community-published themes, apply one (it takes
   * effect immediately and is remembered per-device, never synced to the
   * server), and (if logged in) publish your own. A theme is just a set of
   * CSS variable overrides, which is why applying one is a pure client action.
   */
  import { enhance } from '$app/forms';
  import { applyTheme, THEME_STORAGE_KEY } from '$lib/theme';
  import type { Theme, ThemeVariables } from '@counter/types';
  let { data, form } = $props();

  // Which theme is currently applied, so the matching card can show "Applied".
  // Local UI state only; it isn't read back from anywhere on load.
  let active = $state<string | null>(null);

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
</script>

<svelte:head><title>Themes · Counter</title></svelte:head>

<div class="spread head">
  <div>
    <h1 class="title">Themes</h1>
    <p class="muted sub">Themes are just CSS variable overrides. Apply one instantly — it's saved on this device.</p>
  </div>
  <button class="btn" onclick={reset}>Default</button>
</div>

<div class="grid">
  {#each data.themes.data as theme (theme.id)}
    <div class="tcard panel" class:active={active === theme.id}>
      <div class="swatches">
        {#each swatches(theme.variables) as c (c)}
          <span class="sw" style="background:{c}"></span>
        {/each}
      </div>
      <strong>{theme.name}</strong>
      {#if theme.description}<p class="desc muted">{theme.description}</p>{/if}
      {#if theme.author}<p class="by faint">by <a href="/{theme.author.username}">@{theme.author.username}</a></p>{/if}
      <button class="btn btn-primary apply" onclick={() => use(theme)}>
        {active === theme.id ? 'Applied' : 'Apply'}
      </button>
    </div>
  {:else}
    <p class="muted">No themes published yet.</p>
  {/each}
</div>

<!-- Publish form, members only. The colour inputs default to the app's stock
     palette so a new theme starts from the current look rather than black. -->
{#if data.user}
  <section class="panel create">
    <h2>Publish a theme</h2>
    {#if form?.error}<p class="error">{form.error}</p>{/if}
    <form method="POST" action="?/create" use:enhance class="stack">
      <div>
        <label for="name">Name</label>
        <input id="name" name="name" required maxlength="80" />
      </div>
      <div>
        <label for="description">Description <span class="faint">(optional)</span></label>
        <input id="description" name="description" maxlength="500" />
      </div>
      <div class="colors">
        <label class="cl">Background<input type="color" name="bg" value="#0a0b0f" /></label>
        <label class="cl">Surface<input type="color" name="bg2" value="#0f1117" /></label>
        <label class="cl">Text<input type="color" name="text" value="#e9ebf2" /></label>
        <label class="cl">Accent<input type="color" name="accent" value="#7aa2ff" /></label>
        <label class="cl">Accent 2<input type="color" name="accent2" value="#b48cff" /></label>
      </div>
      <button class="btn btn-primary" type="submit">Publish theme</button>
    </form>
  </section>
{/if}

<style>
  .head { align-items: flex-end; margin-bottom: var(--space-4); }
  .title { margin: 0; }
  .sub { margin: var(--space-1) 0 0; }
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
  .apply { margin-top: var(--space-2); }
  .create { padding: var(--space-5); margin-top: var(--space-5); }
  .create h2 { font-size: 1.1rem; }
  .colors { display: flex; flex-wrap: wrap; gap: var(--space-3); }
  .cl { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 0.78rem; }
  .cl input[type='color'] { width: 48px; height: 36px; padding: 2px; cursor: pointer; }
</style>
