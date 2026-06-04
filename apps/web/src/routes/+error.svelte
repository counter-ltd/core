<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The catch-all error page. SvelteKit renders this whenever a load or action
   * throws, or a route 404s. We read everything we need off `page`: the status
   * code and the error SvelteKit attached, so there are no props to wire up.
   */
  import { page } from '$app/state';
</script>

<svelte:head><title>{page.status} · Counter</title></svelte:head>

<div class="err panel">
  <h1>{page.status}</h1>
  <!-- error can be null for a bare 404, so fall back to a generic line -->
  <p class="muted">{page.error?.message ?? 'Something went wrong.'}</p>
  <a class="btn btn-primary" href="/">Back to the public square</a>
</div>

<style>
  .err {
    padding: var(--space-6);
    text-align: center;
    margin: 10vh auto 0;
    max-width: 420px;
  }
  .err h1 {
    font-size: 3rem;
    margin: 0;
  }
  .btn {
    margin-top: var(--space-4);
  }
</style>
