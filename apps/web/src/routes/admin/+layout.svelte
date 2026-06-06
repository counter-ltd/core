<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The admin panel shell: a heading and a permission-aware sub-nav across the
   * five sections. A tab only appears when the caller holds the permission that
   * section's pages need, so a moderator (no group/audit access) sees a shorter
   * bar than an administrator. `data.permissions` comes from the layout gate.
   */
  import { page } from '$app/state';
  import type { Permission } from '@counter/config';

  let { data, children } = $props();

  const perms = $derived(data.permissions as Permission[]);
  const can = (p: Permission) => perms.includes(p);

  // Each section, paired with the permission that unlocks it. The dashboard tab
  // shows for anyone with panel access so there's always a landing page.
  const sections = $derived(
    [
      { href: '/admin', label: 'Dashboard', show: true },
      { href: '/admin/users', label: 'Users', show: can('users.view') },
      { href: '/admin/groups', label: 'Groups', show: can('groups.view') },
      { href: '/admin/reports', label: 'Reports', show: can('reports.view') },
      { href: '/admin/audit', label: 'Audit log', show: can('audit.view') },
    ].filter((s) => s.show),
  );

  const current = $derived(page.url.pathname);
  // Dashboard is an exact match; the rest light up across their subtree.
  const isActive = (href: string) =>
    href === '/admin' ? current === '/admin' : current.startsWith(href);
</script>

<svelte:head><title>Admin · Counter</title></svelte:head>

<header class="admin-head">
  <p class="eyebrow">control panel</p>
  <h1 class="title">Admin</h1>
</header>

<nav class="tabs" aria-label="Admin sections">
  {#each sections as s (s.href)}
    <a class="tab" class:active={isActive(s.href)} href={s.href}>{s.label}</a>
  {/each}
</nav>

{@render children()}

<style>
  .admin-head {
    margin-bottom: var(--space-4);
  }
  /* A small machine-type kicker over the title: orients you without a second
     heading competing for weight. */
  .eyebrow {
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.64rem;
    color: var(--color-text-faint);
    margin: 0 0 var(--space-1);
  }
  .title {
    margin: 0;
    font-size: 1.9rem;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-bottom: var(--space-5);
    border-bottom: 1px solid var(--color-border);
  }
  .tab {
    font-family: var(--mono);
    font-size: 0.82rem;
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-dim);
    border-bottom: 2px solid transparent;
    border-radius: var(--radius) var(--radius) 0 0;
    margin-bottom: -1px;
    transition: color 0.12s ease, background 0.12s ease;
  }
  .tab:hover {
    color: var(--color-text);
    background: var(--color-surface-strong);
  }
  .tab.active {
    color: var(--color-accent);
    border-bottom-color: var(--color-accent);
  }
  .tab.active:hover {
    background: transparent;
  }
</style>
