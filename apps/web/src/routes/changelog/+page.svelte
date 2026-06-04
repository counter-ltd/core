<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Renders the platform changelog. The actual content isn't stored here; the
   * load fetches and parses CHANGELOG.md from the public docs repo into
   * `data.releases` (each with categories and items). `data.error` is set when
   * that fetch or parse fails, so we can show a message instead of a blank page.
   */
  let { data } = $props();
</script>

<svelte:head><title>Changelog · Counter</title></svelte:head>

<header class="panel intro">
  <h1>Changelog</h1>
  <p class="muted">
    Platform-wide changes to Counter — features, API, and infrastructure. Fetched live from
    <a
      href="https://github.com/counter-ltd/documents/blob/main/CHANGELOG.md"
      target="_blank"
      rel="noopener noreferrer"
      class="src-link">counter-ltd/documents</a
    >.
  </p>
</header>

<!-- Three states: the fetch failed, it succeeded but found nothing, or we have
     releases to list. -->
{#if data.error}
  <p class="panel muted err">{data.error}</p>
{:else if data.releases.length === 0}
  <p class="panel muted err">No releases found.</p>
{:else}
  {#each data.releases as release (release.version)}
    <section class="panel release">
      <div class="spread">
        <h2 class="version">{release.version}</h2>
        <!-- A dated release is shipped; a dateless one is still in progress -->
        {#if release.date}
          <span class="date faint">{release.date}</span>
        {:else}
          <span class="pill">unreleased</span>
        {/if}
      </div>

      {#if release.categories.length === 0}
        <p class="muted">No changes listed yet.</p>
      {:else}
        <!-- Categories group items (Added, Fixed, etc.); both come straight
             from the parsed markdown headings and bullets -->
        {#each release.categories as cat (cat.name)}
          <h3 class="cat">{cat.name}</h3>
          <ul class="items">
            {#each cat.items as item (item)}
              <li>{item}</li>
            {/each}
          </ul>
        {/each}
      {/if}
    </section>
  {/each}
{/if}

<style>
  .intro { padding: var(--space-5); margin-bottom: var(--space-4); }
  .intro h1 { font-size: 1.5rem; }
  .src-link { color: var(--color-accent); text-decoration: none; }
  .src-link:hover { text-decoration: underline; }
  .err { padding: var(--space-4); }
  .release { padding: var(--space-5); margin-bottom: var(--space-4); }
  .version { margin: 0; font-size: 1.1rem; }
  .date { font-family: var(--mono); font-size: 0.85rem; }
  .cat {
    margin: var(--space-4) 0 var(--space-2);
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-dim);
  }
  .items {
    margin: 0;
    padding-left: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .items li { font-weight: 300; line-height: 1.5; }
</style>
