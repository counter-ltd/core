<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Shows the outcome of clicking an email-verification link. `data.status` is
   * decided server-side: 'ok' verified the account, 'invalid' means a stale or
   * bad link, 'missing' means someone hit /verify with no token.
   */
  let { data } = $props();
</script>

<svelte:head><title>Verify email · Counter</title></svelte:head>

<div class="verify panel">
  {#if data.status === 'ok'}
    <span class="mark ok" aria-hidden="true">✦</span>
    <h1>Email verified</h1>
    <p class="muted">
      Your address is confirmed and your profile now carries the verified badge.
      It's a signal to others that you're a real person, nothing more, and it
      gates nothing.
    </p>
    <a class="btn btn-primary" href="/">Go to the feed</a>
  {:else if data.status === 'missing'}
    <h1>Nothing to verify</h1>
    <p class="muted">This link is missing its token. Open the link from your email, or resend it from settings.</p>
    <a class="btn" href="/settings">Settings</a>
  {:else}
    <h1>This link didn't work</h1>
    <p class="muted">
      It may have expired or already been used. You can send yourself a fresh one
      from settings.
    </p>
    <a class="btn" href="/settings">Resend from settings</a>
  {/if}
</div>

<style>
  .verify {
    padding: var(--space-5);
    max-width: 460px;
    margin: 8vh auto 0;
    text-align: center;
  }
  .verify h1 { margin: var(--space-3) 0; font-size: 1.5rem; }
  .verify p { line-height: 1.6; margin-bottom: var(--space-4); }
  .mark.ok {
    display: inline-block;
    font-size: 2rem;
    color: var(--color-accent);
  }
  .btn { display: inline-block; }
</style>
