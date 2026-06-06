<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Account settings: email verification, password, passkeys, and the
   * irreversible delete-account flow. Adding a passkey is the one thing here
   * that can't be a plain form post: the WebAuthn ceremony runs in the browser,
   * bracketed by two calls to the /settings/passkeys endpoint. `form` carries
   * each server action's result back.
   */
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { startRegistration } from '@simplewebauthn/browser';

  let { data, form } = $props();
  const p = $derived(data.profile);

  // --- passkeys ---
  let passkeyNickname = $state('');
  let passkeyBusy = $state(false);
  let passkeyError = $state('');

  /**
   * Enrol a new passkey. The ceremony runs in the browser, but it's bracketed by
   * two server calls (options, then verify) because the access token is httpOnly:
   * the /settings/passkeys endpoint attaches it for us. On success we invalidate
   * the page data so the new passkey shows up in the list.
   */
  async function addPasskey() {
    passkeyError = '';
    passkeyBusy = true;
    try {
      const optionsRes = await fetch('/settings/passkeys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step: 'options' }),
      });
      if (!optionsRes.ok) throw new Error('Could not start. Try again.');
      const options = await optionsRes.json();

      const attestation = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch('/settings/passkeys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step: 'verify', response: attestation, nickname: passkeyNickname.trim() }),
      });
      if (!verifyRes.ok) {
        const d = await verifyRes.json().catch(() => null);
        throw new Error(d?.error ?? 'Could not save passkey.');
      }
      passkeyNickname = '';
      await invalidateAll();
    } catch (err) {
      passkeyError = err instanceof Error ? err.message : 'Could not add passkey.';
    } finally {
      passkeyBusy = false;
    }
  }
</script>

<section class="panel card">
  <h2>Account</h2>
  <div class="email-row">
    <p class="muted">Email: {p.email}</p>
    {#if p.verified}
      <span class="badge" title="Email verified">✦ Verified</span>
    {/if}
  </div>
  {#if !p.verified}
    <!-- Verifying is optional: it earns the ✦ badge and gates nothing. -->
    <p class="muted small">
      Verify your email to earn the ✦ badge. It's optional and unlocks nothing, it
      just signals to others that you're a real person.
    </p>
    {#if form?.resent}<p class="ok">Sent. Check your inbox for the link.</p>{/if}
    {#if form?.resendError}<p class="error">{form.resendError}</p>{/if}
    <form method="POST" action="?/resendVerification" use:enhance>
      <button class="btn" type="submit">Send verification email</button>
    </form>
  {/if}
</section>

<section class="panel card">
  <!-- Set vs change: OAuth-only accounts (hasPassword false) are adding their
       first password, so there's no current one to ask for. -->
  <h2>{p.hasPassword ? 'Change password' : 'Set a password'}</h2>
  {#if p.hasPassword}
    <p class="muted small">Update the password you use to sign in.</p>
  {:else}
    <p class="muted small">
      Your account signs in with GitHub or Discord. Add a password to also sign in
      directly with your username or email.
    </p>
  {/if}
  {#if form?.passwordSaved}<p class="ok">Password saved.</p>{/if}
  {#if form?.passwordError}<p class="error">{form.passwordError}</p>{/if}
  <form method="POST" action="?/setPassword" class="stack" use:enhance>
    {#if p.hasPassword}
      <input
        name="currentPassword"
        type="password"
        placeholder="Current password"
        autocomplete="current-password"
        required
      />
    {/if}
    <input
      name="newPassword"
      type="password"
      placeholder="New password"
      autocomplete="new-password"
      required
    />
    <button class="btn" type="submit">{p.hasPassword ? 'Change password' : 'Set password'}</button>
  </form>
</section>

<section class="panel card">
  <h2>Passkeys</h2>
  <p class="muted small">
    Sign in with Touch ID, Face ID, or a security key instead of a password.
    Passkeys are phishing-resistant and never leave your device.
  </p>
  {#if form?.passkeyRenamed}<p class="ok">Passkey renamed.</p>{/if}
  {#if form?.passkeyRemoved}<p class="ok">Passkey removed.</p>{/if}
  {#if passkeyError}<p class="error">{passkeyError}</p>{/if}

  {#if data.passkeys.length === 0}
    <p class="muted small">No passkeys yet.</p>
  {:else}
    <ul class="passkeys">
      {#each data.passkeys as key (key.id)}
        <li class="passkey-row">
          <div class="passkey-meta">
            <span class="passkey-name">{key.nickname || 'Passkey'}</span>
            <span class="faint small">
              Added {new Date(key.createdAt).toLocaleDateString()}
              {#if key.lastUsedAt}· last used {new Date(key.lastUsedAt).toLocaleDateString()}{/if}
            </span>
          </div>
          <!-- Rename and remove are plain form posts; only the add ceremony needs
               client-side WebAuthn. -->
          <form method="POST" action="?/renamePasskey" class="passkey-rename" use:enhance>
            <input type="hidden" name="id" value={key.id} />
            <input name="nickname" placeholder="Rename" value={key.nickname ?? ''} maxlength="64" />
            <button class="btn-link" type="submit">Save</button>
          </form>
          <form method="POST" action="?/removePasskey" use:enhance>
            <input type="hidden" name="id" value={key.id} />
            <button class="btn-link danger" type="submit">Remove</button>
          </form>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="stack add-passkey">
    <input bind:value={passkeyNickname} placeholder="Passkey name (optional)" maxlength="64" />
    <button class="btn" type="button" onclick={addPasskey} disabled={passkeyBusy}>
      {passkeyBusy ? 'Waiting for passkey…' : 'Add a passkey'}
    </button>
  </div>
</section>

<section class="panel card">
  <h2 class="danger-h">Delete account</h2>
  <p class="muted">
    This hard-deletes everything you own — posts, likes, follows, sessions. It cannot be undone.
    Anonymous view counts on your posts remain as aggregate numbers with no link to you.
  </p>
  <!-- The "type DELETE" check is enforced by the server action, not here, so
       it can't be bypassed by editing the page. This form posts a normal
       request (no use:enhance) since a successful delete redirects away. -->
  <form method="POST" action="?/deleteAccount" class="stack del">
    <input name="confirm" placeholder="Type DELETE to confirm" autocomplete="off" />
    <button class="btn danger" type="submit">Delete my account</button>
  </form>
</section>

<style>
  .email-row { display: flex; align-items: center; gap: var(--space-3); }
  .passkeys { list-style: none; padding: 0; margin: var(--space-3) 0; }
  .passkey-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-border);
  }
  .passkey-meta { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .passkey-name { font-weight: 500; }
  .passkey-rename { display: flex; gap: var(--space-2); align-items: center; }
  .add-passkey { margin-top: var(--space-3); }
  .danger-h { color: var(--color-danger); }
  .del { max-width: 360px; }
  .btn.danger { border-color: var(--color-danger); color: var(--color-danger); }
  .btn.danger:hover { background: var(--color-danger); color: #fff; }
  .btn-link.danger { color: var(--color-danger); }
</style>
