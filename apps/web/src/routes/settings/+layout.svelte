<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Shell for the settings section. The old single page crammed six tabs and
   * every form into one 1000-line component; now each section is its own route
   * under /settings, so a page only loads and renders its own slice. This layout
   * holds the title and the section nav; the active item is derived from the URL.
   *
   * Styles common to more than one section (cards, the save/ok flash, toggle
   * rows) live here as `:global` rules scoped under `.settings-shell`, so the
   * child pages don't each re-declare them. Section-specific styles stay in the
   * page that uses them.
   */
  import { page } from '$app/state';

  let { children } = $props();

  const sections = [
    { href: '/settings/profile', label: 'Profile' },
    { href: '/settings/connections', label: 'Connections' },
    { href: '/settings/notifications', label: 'Notifications' },
    { href: '/settings/integrations', label: 'Integrations' },
    { href: '/settings/privacy', label: 'Privacy' },
    { href: '/settings/account', label: 'Account' },
  ];

  const current = $derived(page.url.pathname);
</script>

<svelte:head><title>Settings · Counter</title></svelte:head>

<h1 class="title">Settings</h1>

<div class="settings-shell">
  <nav class="section-nav" aria-label="Settings sections">
    {#each sections as s (s.href)}
      <a class="section-link" class:active={current.startsWith(s.href)} href={s.href}>{s.label}</a>
    {/each}
  </nav>

  <div class="section-content">
    {@render children()}
  </div>
</div>

<style>
  .title { margin-bottom: var(--space-3); }

  /* Sidebar on wide screens, a wrapping strip on narrow ones. */
  .settings-shell {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: var(--space-5);
    align-items: start;
  }
  .section-nav {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    position: sticky;
    top: var(--space-4);
  }
  .section-link {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    color: var(--color-text-dim);
    font-size: 0.9rem;
    transition: color 0.15s, background 0.15s;
  }
  .section-link:hover { color: var(--color-text); }
  .section-link.active {
    color: var(--color-accent);
    background: var(--color-surface);
  }

  @media (max-width: 640px) {
    .settings-shell { grid-template-columns: 1fr; gap: var(--space-3); }
    .section-nav {
      flex-direction: row;
      flex-wrap: wrap;
      position: static;
    }
  }

  /* --- shared section styles (scoped to settings, used by 2+ pages) --- */
  :global(.settings-shell .card) { padding: var(--space-5); margin-bottom: var(--space-4); }
  :global(.settings-shell .card h2) { font-size: 1.1rem; }
  :global(.settings-shell .ok) { color: var(--color-repost); }
  :global(.settings-shell .small) { font-size: 0.88rem; }
  :global(.settings-shell .badge) {
    font-family: var(--mono);
    font-size: 0.75rem;
    color: var(--color-accent);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-pill);
    padding: 0.1em 0.6em;
  }
  :global(.settings-shell .btn-link) {
    background: none;
    border: none;
    padding: 0;
    color: var(--color-accent);
    cursor: pointer;
    font-size: inherit;
    text-decoration: underline;
  }
  :global(.settings-shell .toggles) {
    list-style: none;
    margin: var(--space-3) 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  :global(.settings-shell .toggles li) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }
  :global(.settings-shell .toggles label) { margin: 0; }
</style>
