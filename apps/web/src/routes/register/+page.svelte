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
  import { env } from '$env/dynamic/public';
  let { form } = $props();

  const apiUrl = env.PUBLIC_API_URL || 'http://localhost:3000';
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

  <div class="divider"><span>or sign up with</span></div>

  <div class="oauth">
    <a href="{apiUrl}/auth/github" class="btn btn-oauth">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
      </svg>
      GitHub
    </a>
    <a href="{apiUrl}/auth/discord" class="btn btn-oauth">
      <svg width="16" height="16" viewBox="0 0 127.14 96.36" fill="currentColor" aria-hidden="true">
        <path d="M107.7 8.07A105.15 105.15 0 0081.47 0a72.06 72.06 0 00-3.36 6.83 97.68 97.68 0 00-29.11 0A72.37 72.37 0 0045.64 0a105.89 105.89 0 00-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0032.17 16.15 77.7 77.7 0 006.89-11.11 68.42 68.42 0 01-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0064.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 01-10.87 5.19 77 77 0 006.89 11.1 105.25 105.25 0 0032.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15zM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69z"/>
      </svg>
      Discord
    </a>
  </div>

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
  .divider {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-4) 0;
    color: var(--color-text-dim);
    font-size: 0.8rem;
  }
  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--color-border);
  }
  .oauth {
    display: flex;
    gap: var(--space-2);
  }
  .btn-oauth {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    text-decoration: none;
  }
</style>
