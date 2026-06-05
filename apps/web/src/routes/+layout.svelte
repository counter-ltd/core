<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The root shell every page renders inside: the sidebar nav plus the main
   * column. `data.user` comes from the root load and tells the nav whether
   * someone's logged in; `children` is whatever page matched the route.
   */
  import '../app.css';
  import Nav from '$lib/components/Nav.svelte';
  import { applyTheme, setMode, THEME_STORAGE_KEY, MODE_STORAGE_KEY } from '$lib/theme';
  import { startHeartbeat, stopHeartbeat } from '$lib/heartbeat';
  import type { ThemeVariables } from '@counter/types';

  let { data, children } = $props();

  // Start or stop the presence heartbeat whenever the user's settings change.
  // $effect runs client-only, so the interval never touches the SSR pass.
  $effect(() => {
    const ps = data.user?.presenceSettings;
    if (ps?.onlineStatusEnabled || ps?.lastSeenEnabled) {
      startHeartbeat(ps.heartbeatIntervalSeconds);
    } else {
      stopHeartbeat();
    }
    return stopHeartbeat;
  });

  // A theme is just a bag of CSS variable overrides we keep per-device in
  // localStorage, so it never round-trips to the server. We re-apply it on the
  // client after mount; the server-rendered page already looks right with the
  // defaults, this only layers a custom theme back on top for people who picked
  // one. Runs in an $effect so it's client-only; localStorage doesn't exist
  // during SSR.
  $effect(() => {
    try {
      const mode = localStorage.getItem(MODE_STORAGE_KEY);
      if (mode === 'light' || mode === 'dark') setMode(mode);
      const raw = localStorage.getItem(THEME_STORAGE_KEY);
      if (raw) applyTheme(JSON.parse(raw) as ThemeVariables);
    } catch {
      // Bad JSON or storage that's been tampered with shouldn't take the whole
      // app down. Just fall back to the default look.
    }
  });
</script>

<div class="shell">
  <aside class="side">
    <Nav user={data.user} accounts={data.accounts ?? []} />
  </aside>
  <main class="main">
    {@render children()}
  </main>
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: 260px minmax(0, var(--maxw));
    gap: var(--space-5);
    max-width: 920px;
    margin: 0 auto;
    padding: var(--space-4);
    align-items: start;
  }
  .main {
    min-width: 0;
    padding-bottom: 30vh;
  }
  @media (max-width: 800px) {
    .shell {
      grid-template-columns: 1fr;
      gap: var(--space-4);
    }
  }
</style>
