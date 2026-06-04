<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Sign-up page. Same shape as login: a form posting to a server action, with
   * `form` carrying back the error and previously-entered values on failure.
   * The length/pattern limits come from the shared USER config so the client
   * validates against the exact same rules the server enforces.
   */
  import { enhance } from '$app/forms';
  import { USER } from '@counter/config';
  let { form } = $props();
</script>

<svelte:head><title>Sign up · Counter</title></svelte:head>

<div class="auth panel">
  <h1>Join Counter</h1>
  <p class="muted">Public by default. Insights from your first post. No tracking.</p>

  <form method="POST" use:enhance class="stack">
    <div>
      <label for="username">Username</label>
      <input
        id="username"
        name="username"
        value={form?.username ?? ''}
        minlength={USER.MIN_USERNAME_LENGTH}
        maxlength={USER.MAX_USERNAME_LENGTH}
        pattern="[a-zA-Z0-9_]+"
        autocomplete="username"
        required
      />
    </div>
    <div>
      <label for="displayName">Display name <span class="faint">(optional)</span></label>
      <input id="displayName" name="displayName" value={form?.displayName ?? ''} maxlength={USER.MAX_DISPLAY_NAME_LENGTH} />
    </div>
    <div>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value={form?.email ?? ''} autocomplete="email" required />
    </div>
    <div>
      <label for="password">Password <span class="faint">(min {USER.MIN_PASSWORD_LENGTH})</span></label>
      <!-- Password is never echoed back from `form`, even on error, so a typed
           password can't survive in the page's HTML -->
      <input id="password" name="password" type="password" minlength={USER.MIN_PASSWORD_LENGTH} autocomplete="new-password" required />
    </div>
    {#if form?.error}<p class="error">{form.error}</p>{/if}
    <button class="btn btn-primary" type="submit">Create account</button>
  </form>

  <p class="muted alt">Already have an account? <a href="/login">Log in</a></p>
</div>

<style>
  .auth {
    padding: var(--space-5);
    max-width: 440px;
    margin: 6vh auto 0;
  }
  .alt {
    margin-top: var(--space-4);
  }
</style>
