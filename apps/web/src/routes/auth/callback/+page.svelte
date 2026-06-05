<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * OAuth callback landing page. The server load does all the work and redirects
   * away on success, so this page only renders on error.
   */
  let { data } = $props();
</script>

<svelte:head><title>Signing in · Counter</title></svelte:head>

<div class="auth panel">
  {#if data.error}
    <h1>Sign-in failed</h1>
    <p class="error">{data.error}</p>
    <p class="muted"><a href="/login">Back to login</a></p>
  {:else}
    <p class="muted">Finishing up…</p>
  {/if}
</div>

<style>
  .auth {
    padding: var(--space-5);
    max-width: 420px;
    margin: 8vh auto 0;
  }
</style>
