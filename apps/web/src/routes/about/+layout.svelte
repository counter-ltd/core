<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Shell for the "About Counter" section: a single tab bar over the
   * transparency/meta pages (Algorithm, Your data, Changelog) that used to sit
   * as separate top-level items in the sidebar. Each tab is a real route under
   * /about, so navigation is plain links and the active one is derived from the
   * current path. Every child page keeps its own <title> and intro.
   */
  import { page } from '$app/state';

  let { children } = $props();

  const tabs = [
    { href: '/about/algorithm', label: 'Algorithm' },
    { href: '/about/data', label: 'Your data' },
    { href: '/about/changelog', label: 'Changelog' },
  ];

  const current = $derived(page.url.pathname);
</script>

<nav class="tabs" aria-label="About sections">
  {#each tabs as t (t.href)}
    <a class="tab" class:active={current.startsWith(t.href)} href={t.href}>{t.label}</a>
  {/each}
</nav>

{@render children()}

<style>
  .tabs {
    display: flex;
    gap: 0;
    flex-wrap: wrap;
    margin-bottom: var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }
  .tab {
    border-bottom: 2px solid transparent;
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-dim);
    font-size: 0.88rem;
    /* Pull the 2px active border down onto the container's 1px border so the
       two sit flush instead of stacking. */
    margin-bottom: -1px;
    transition: color 0.15s, border-bottom-color 0.15s;
  }
  .tab:hover { color: var(--color-text); }
  .tab.active { color: var(--color-accent); border-bottom-color: var(--color-accent); }
</style>
