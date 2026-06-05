<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Set-a-new-password form. Three states: the link had no token (broken), the
   * reset succeeded (`form.done`), or the form itself. The token comes from the
   * server load and rides along as a hidden field. Resetting logs every device
   * out, so the success copy sends them to a fresh login rather than the feed.
   */
  import { enhance } from '$app/forms';
  let { data, form } = $props();
</script>

<svelte:head><title>Set a new password · Counter</title></svelte:head>

<div class="auth panel">
  {#if form?.done}
    <h1>Password updated</h1>
    <p class="muted">
      Your password is set. For safety we signed out every device, so log in
      again with your new password.
    </p>
    <a class="btn btn-primary" href="/login">Log in</a>
  {:else if !data.hasToken}
    <h1>This link is broken</h1>
    <p class="muted">
      It's missing its token. Open the link straight from the reset email, or
      <a href="/forgot-password">request a new one</a>.
    </p>
  {:else}
    <h1>Set a new password</h1>
    <p class="muted">Choose something you don't use elsewhere.</p>

    <form method="POST" use:enhance class="stack">
      <input type="hidden" name="token" value={data.token} />
      <div>
        <label for="password">New password</label>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="new-password"
          required
        />
      </div>
      <div>
        <label for="confirm">Confirm new password</label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autocomplete="new-password"
          required
        />
      </div>
      {#if form?.error}<p class="error">{form.error}</p>{/if}
      <button class="btn btn-primary" type="submit">Update password</button>
    </form>
  {/if}
</div>

<style>
  .auth {
    padding: var(--space-5);
    max-width: 420px;
    margin: 8vh auto 0;
  }
</style>
