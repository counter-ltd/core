<script lang="ts">
  import '../app.css';
  import Nav from '$lib/components/Nav.svelte';
  import { applyTheme, setMode, THEME_STORAGE_KEY, MODE_STORAGE_KEY } from '$lib/theme';
  import type { ThemeVariables } from '@counter/types';

  let { data, children } = $props();

  // Restore the locally-stored theme + mode on mount. Theme application is
  // entirely client-side variable overrides — the base render is already correct.
  $effect(() => {
    try {
      const mode = localStorage.getItem(MODE_STORAGE_KEY);
      if (mode === 'light' || mode === 'dark') setMode(mode);
      const raw = localStorage.getItem(THEME_STORAGE_KEY);
      if (raw) applyTheme(JSON.parse(raw) as ThemeVariables);
    } catch {
      /* ignore malformed storage */
    }
  });
</script>

<div class="shell">
  <aside class="side">
    <Nav user={data.user} />
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
