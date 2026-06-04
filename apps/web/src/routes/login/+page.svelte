<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Login page. The actual auth happens in the server action; this is just the
   * form. `form` carries back what the action returned on failure: the error
   * message and the identifier the user typed, so we can repopulate it without
   * making them retype. `use:enhance` keeps the submit a client-side fetch and
   * avoids a full page reload.
   */
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  let { form } = $props();

  // After an account is deleted the server bounces here with ?deleted=1. The
  // license (Condition 6) requires confirming the deletion to the user in
  // writing, and this banner is that written confirmation.
  const justDeleted = $derived(page.url.searchParams.get('deleted') === '1');
</script>

<svelte:head><title>Log in · Counter</title></svelte:head>

<div class="auth panel">
  {#if justDeleted}
    <p class="deleted" role="status">
      Your account and all associated personal data have been permanently
      deleted. Anonymous, aggregate view counts that can't identify you may
      remain. Thanks for having been here.
    </p>
  {/if}
  <h1>Welcome back</h1>
  <p class="muted">Log in to post, follow, and see your feed.</p>

  <form method="POST" use:enhance class="stack">
    <div>
      <label for="identifier">Username or email</label>
      <input id="identifier" name="identifier" value={form?.identifier ?? ''} autocomplete="username" required />
    </div>
    <div>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
    </div>
    {#if form?.error}<p class="error">{form.error}</p>{/if}
    <button class="btn btn-primary" type="submit">Log in</button>
  </form>

  <p class="muted alt">No account? <a href="/register">Create one</a></p>
</div>

<style>
  .auth {
    padding: var(--space-5);
    max-width: 420px;
    margin: 8vh auto 0;
  }
  .alt {
    margin-top: var(--space-4);
  }
  .deleted {
    margin-bottom: var(--space-4);
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface-strong);
    color: var(--color-text-dim);
    font-size: 0.9rem;
    line-height: 1.5;
  }
</style>
