<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Request-a-reset form. The work happens in the server action; this is just
   * the email field and the two states it can land in: a uniform "check your
   * inbox" confirmation (shown whether or not the address was real), or the
   * field back with an error. `use:enhance` keeps the submit a client fetch.
   */
  import { enhance } from '$app/forms';
  let { form } = $props();
</script>

<svelte:head><title>Reset password · Counter</title></svelte:head>

<div class="auth panel">
  {#if form?.sent}
    <h1>Check your inbox</h1>
    <p class="muted">
      If that address belongs to a Counter account, a reset link is on its way.
      The link is good for one hour. Didn't get it? Check spam, or
      <a href="/forgot-password">try again</a>.
    </p>
    <a class="btn" href="/login">Back to log in</a>
  {:else}
    <h1>Forgot your password?</h1>
    <p class="muted">Enter your account email and we'll send a link to set a new one.</p>

    <form method="POST" use:enhance class="stack">
      <div>
        <label for="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          value={form?.email ?? ''}
          autocomplete="email"
          required
        />
      </div>
      {#if form?.error}<p class="error">{form.error}</p>{/if}
      <button class="btn btn-primary" type="submit">Send reset link</button>
    </form>

    <p class="muted alt">Remembered it? <a href="/login">Log in</a></p>
  {/if}
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
</style>
