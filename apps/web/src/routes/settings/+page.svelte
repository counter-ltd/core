<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Account settings, three panels: edit profile (a server-action form),
   * appearance (light/dark, applied straight to the DOM and saved per-device),
   * and account (email plus the irreversible delete-account flow). `form`
   * carries the save/error result back from the profile action.
   */
  import { enhance } from '$app/forms';
  import { setMode } from '$lib/theme';
  import { INTEGRATION_PLATFORMS } from '@counter/types';
  let { data, form } = $props();
  const p = $derived(data.profile);
  // The canonical profile URL a linked page must rel="me" back to. Matches what
  // the API checks (PUBLIC_WEB_URL/username), so the instruction shown here is
  // exactly the link that will verify.
  const profileUrl = $derived(`https://counter.ltd/${p.username}`);
</script>

<svelte:head><title>Settings · Counter</title></svelte:head>

<h1 class="title">Settings</h1>

<section class="panel card">
  <h2>Profile</h2>
  {#if form?.saved}<p class="ok">Saved.</p>{/if}
  {#if form?.error}<p class="error">{form.error}</p>{/if}
  <form method="POST" action="?/profile" use:enhance class="stack">
    <div>
      <label for="displayName">Display name</label>
      <input id="displayName" name="displayName" value={p.displayName ?? ''} maxlength="60" />
    </div>
    <div>
      <label for="bio">Bio</label>
      <textarea id="bio" name="bio" maxlength="300">{p.bio ?? ''}</textarea>
    </div>
    <div>
      <label for="avatarUrl">Avatar URL</label>
      <input id="avatarUrl" name="avatarUrl" type="url" value={p.avatarUrl ?? ''} placeholder="https://…" />
    </div>
    <button class="btn btn-primary" type="submit">Save profile</button>
  </form>
</section>

<section class="panel card">
  <h2>Appearance</h2>
  <p class="muted">Dark by default. Light is a theme choice. Browse more in <a href="/themes">Themes</a>.</p>
  <!-- Mode flips instantly on the client (no server round-trip); setMode also
       persists the choice so it survives a reload. -->
  <div class="row">
    <button class="btn" onclick={() => setMode('dark')}>Dark</button>
    <button class="btn" onclick={() => setMode('light')}>Light</button>
  </div>
</section>

<section class="panel card">
  <h2>Links</h2>
  <p class="muted small">
    Link accounts you control to earn verified badges. Add a <code>rel="me"</code>
    link back to your profile (<span class="faint">{profileUrl}</span>) on the
    other page, then Verify. Optional, and it gates nothing.
  </p>
  {#if form?.linkError}<p class="error">{form.linkError}</p>{/if}
  {#if form?.linkVerified}<p class="ok">Verified. The badge is on your profile.</p>{/if}
  {#if form?.linkUnverified}
    <p class="error">No <code>rel="me"</code> link back to your profile found on that page yet.</p>
  {/if}

  {#if data.links.length}
    <ul class="links">
      {#each data.links as link (link.id)}
        <li>
          <span class="lk">
            <strong>{link.platform}</strong>
            <a href={link.url} target="_blank" rel="noopener" class="faint url">{link.url}</a>
          </span>
          <span class="lk-actions">
            {#if link.verified}
              <span class="badge">✦ verified</span>
            {:else}
              <form method="POST" action="?/verifyLink" use:enhance>
                <input type="hidden" name="id" value={link.id} />
                <button class="btn" type="submit">Verify</button>
              </form>
            {/if}
            <form method="POST" action="?/removeLink" use:enhance>
              <input type="hidden" name="id" value={link.id} />
              <button class="btn rm" type="submit" aria-label="Remove link">×</button>
            </form>
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  <form method="POST" action="?/addLink" use:enhance class="add-link">
    <select name="platform" aria-label="Platform">
      {#each INTEGRATION_PLATFORMS as platform (platform)}
        <option value={platform}>{platform}</option>
      {/each}
    </select>
    <input name="url" type="url" placeholder="https://…" required />
    <button class="btn" type="submit">Add link</button>
  </form>
</section>

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
    <form method="POST" action="?/resendVerification" use:enhance>
      <button class="btn" type="submit">Send verification email</button>
    </form>
  {/if}
  <hr />
  <h3 class="danger-h">Delete account</h3>
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
  .title { margin-bottom: var(--space-4); }
  .card { padding: var(--space-5); margin-bottom: var(--space-4); }
  .card h2 { font-size: 1.1rem; }
  .ok { color: var(--color-repost); }
  .email-row { display: flex; align-items: center; gap: var(--space-3); }
  .badge {
    font-family: var(--mono);
    font-size: 0.75rem;
    color: var(--color-accent);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-pill);
    padding: 0.1em 0.6em;
  }
  .small { font-size: 0.88rem; }
  .links { list-style: none; margin: var(--space-3) 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .links li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }
  .lk { display: flex; flex-direction: column; min-width: 0; }
  .lk .url { font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
  .lk-actions { display: flex; align-items: center; gap: var(--space-2); }
  .lk-actions form { margin: 0; }
  .btn.rm { padding: 0.1em 0.5em; }
  .add-link { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .add-link select, .add-link input { flex: 1; min-width: 120px; }
  .danger-h { color: var(--color-danger); font-size: 1rem; }
  .del { max-width: 360px; }
  .btn.danger { border-color: var(--color-danger); color: var(--color-danger); }
  .btn.danger:hover { background: var(--color-danger); color: #fff; }
</style>
