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
  import { env } from '$env/dynamic/public';
  import { startAuthentication } from '@simplewebauthn/browser';
  let { form } = $props();

  const apiUrl = env.PUBLIC_API_URL || 'http://localhost:3000';

  // Passkey sign-in error, shown inline. Separate from `form.error` (the
  // password form) since this flow never round-trips through a form action.
  let passkeyError = $state('');
  let passkeyBusy = $state(false);

  /**
   * Run the WebAuthn assertion in the browser, then hand it to our server
   * endpoint to exchange for a session. The ceremony must happen client-side
   * (only the browser can reach the authenticator); the cookie-setting must
   * happen server-side, hence the two-step handoff.
   */
  async function signInWithPasskey() {
    passkeyError = '';
    passkeyBusy = true;
    try {
      const optionsRes = await fetch(`${apiUrl}/auth/passkeys/authenticate/options`, {
        method: 'POST',
      });
      if (!optionsRes.ok) throw new Error('Could not start passkey sign-in.');
      const options = await optionsRes.json();

      const assertion = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch('/login/passkey', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(assertion),
      });
      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => null);
        throw new Error(data?.error ?? 'Passkey sign-in failed.');
      }
      // Server set the session cookie on the response; go to the feed.
      window.location.assign('/feed');
    } catch (err) {
      // A user cancelling the native prompt throws too; keep the copy gentle.
      passkeyError = err instanceof Error ? err.message : 'Passkey sign-in failed.';
      passkeyBusy = false;
    }
  }

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
      <a class="forgot" href="/forgot-password">Forgot password?</a>
    </div>
    {#if form?.error}<p class="error">{form.error}</p>{/if}
    <button class="btn btn-primary" type="submit">Log in</button>
  </form>

  <div class="divider"><span>or</span></div>

  <div class="oauth">
    <button type="button" class="btn btn-oauth" onclick={signInWithPasskey} disabled={passkeyBusy}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M10.5 1a3.5 3.5 0 00-1.5 6.66V8L8 9l1 1-1 1 1 1-1.5 1.5L8 15l1.25-1.25V7.66A3.5 3.5 0 0010.5 1zm0 2.25a1.25 1.25 0 110 2.5 1.25 1.25 0 010-2.5z"/>
      </svg>
      {passkeyBusy ? 'Waiting for passkey…' : 'Sign in with a passkey'}
    </button>
    {#if passkeyError}<p class="error">{passkeyError}</p>{/if}
    <a href="{apiUrl}/auth/github" class="btn btn-oauth">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
      </svg>
      Continue with GitHub
    </a>
    <a href="{apiUrl}/auth/discord" class="btn btn-oauth">
      <svg width="16" height="16" viewBox="0 0 127.14 96.36" fill="currentColor" aria-hidden="true">
        <path d="M107.7 8.07A105.15 105.15 0 0081.47 0a72.06 72.06 0 00-3.36 6.83 97.68 97.68 0 00-29.11 0A72.37 72.37 0 0045.64 0a105.89 105.89 0 00-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0032.17 16.15 77.7 77.7 0 006.89-11.11 68.42 68.42 0 01-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0064.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 01-10.87 5.19 77 77 0 006.89 11.1 105.25 105.25 0 0032.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15zM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69z"/>
      </svg>
      Continue with Discord
    </a>
  </div>

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
  .forgot {
    display: inline-block;
    margin-top: var(--space-1);
    font-size: 0.8rem;
    color: var(--color-text-dim);
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
    flex-direction: column;
    gap: var(--space-2);
  }
  .btn-oauth {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
    text-decoration: none;
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
