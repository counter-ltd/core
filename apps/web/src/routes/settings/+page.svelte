<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Account settings panels: edit profile (a server-action form), appearance
   * (light/dark, applied straight to the DOM and saved per-device), notifications
   * (per-type toggles), links, privacy (device list), and account management.
   * `form` carries each action's save/error result back.
   */
  import { enhance } from '$app/forms';
  import { setMode } from '$lib/theme';
  import { INTEGRATION_PLATFORMS } from '@counter/types';
  import { NOTIFICATION_TYPES, PRESENCE } from '@counter/config';
  import type { NotificationType, PresenceVisibility } from '@counter/config';
  let { data, form } = $props();
  const p = $derived(data.profile);

  /** Format an ISO date string as a short human-readable date. */
  function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // The human label for each notification toggle. Keyed by the type union so a
  // new notification type is a compile error here until it's given a label.
  const visibilityLabels: Record<PresenceVisibility, string> = {
    everyone: 'Everyone',
    followers: 'Followers',
    mutualFollowers: 'Followers I follow',
  };

  const notifyLabels: Record<NotificationType, string> = {
    like: 'Likes',
    repost: 'Reposts',
    reply: 'Replies',
    follow: 'New followers',
    mention: 'Mentions',
    message: 'Direct messages',
  };
  // The canonical profile URL a linked page must rel="me" back to. Matches what
  // the API checks (PUBLIC_WEB_URL/username), so the instruction shown here is
  // exactly the link that will verify.
  const profileUrl = $derived(`https://counter.ltd/${p.username}`);

  // Mirrors the range slider so the adjacent label stays in sync as the user
  // drags; the form value is still the canonical source on submit.
  let heartbeatInterval = $state(data.presenceSettings.heartbeatIntervalSeconds);
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
  <h2>Notifications</h2>
  <p class="muted small">
    Choose what you're notified about, in the app and on your phone. Turning a
    type off stops it everywhere; insights and the rest stay untouched.
  </p>
  {#if form?.notifySaved}<p class="ok">Saved.</p>{/if}
  {#if form?.notifyError}<p class="error">{form.notifyError}</p>{/if}
  <!-- An unchecked box sends no value, so the action reads each absent key as
       "off"; that's why we don't need a hidden companion input per toggle. -->
  <form method="POST" action="?/notifications" use:enhance class="stack">
    <ul class="toggles">
      {#each NOTIFICATION_TYPES as type (type)}
        <li>
          <label for="notify-{type}">{notifyLabels[type]}</label>
          <input
            id="notify-{type}"
            name={type}
            type="checkbox"
            checked={data.notificationPrefs[type]}
          />
        </li>
      {/each}
    </ul>
    <button class="btn btn-primary" type="submit">Save notifications</button>
  </form>
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
  <h2>Privacy</h2>

  <!-- Online status and last seen are both off by default. Each has an
       independent visibility option so you can show one to followers and
       the other to mutual followers, for example. -->
  {#if form?.presenceSaved}<p class="ok">Saved.</p>{/if}
  {#if form?.presenceError}<p class="error">{form.presenceError}</p>{/if}
  <form method="POST" action="?/presence" use:enhance class="stack">
    <h3 class="sub-h">Online status</h3>
    <p class="muted small">Show a live indicator when you're active. Off by default.</p>
    <ul class="toggles">
      <li>
        <label for="onlineStatusEnabled">Show online status</label>
        <input
          id="onlineStatusEnabled"
          name="onlineStatusEnabled"
          type="checkbox"
          checked={data.presenceSettings.onlineStatusEnabled}
        />
      </li>
    </ul>
    <div class="vis-row">
      <label for="onlineStatusVisibility" class="vis-label">Visible to</label>
      <select id="onlineStatusVisibility" name="onlineStatusVisibility">
        {#each PRESENCE.VISIBILITY_OPTIONS as opt (opt)}
          <option value={opt} selected={data.presenceSettings.onlineStatusVisibility === opt}>
            {visibilityLabels[opt]}
          </option>
        {/each}
      </select>
    </div>

    <h3 class="sub-h" style="margin-top: var(--space-4)">Last seen</h3>
    <p class="muted small">Show how long ago you were last active. Off by default.</p>
    <ul class="toggles">
      <li>
        <label for="lastSeenEnabled">Show last seen</label>
        <input
          id="lastSeenEnabled"
          name="lastSeenEnabled"
          type="checkbox"
          checked={data.presenceSettings.lastSeenEnabled}
        />
      </li>
    </ul>
    <div class="vis-row">
      <label for="lastSeenVisibility" class="vis-label">Visible to</label>
      <select id="lastSeenVisibility" name="lastSeenVisibility">
        {#each PRESENCE.VISIBILITY_OPTIONS as opt (opt)}
          <option value={opt} selected={data.presenceSettings.lastSeenVisibility === opt}>
            {visibilityLabels[opt]}
          </option>
        {/each}
      </select>
    </div>

    <h3 class="sub-h" style="margin-top: var(--space-4)">Heartbeat interval</h3>
    <p class="muted small">
      How often your client signals that you're active, in seconds.
      Shorter intervals update your status faster; longer ones use less bandwidth.
    </p>
    <div class="interval-row">
      <input
        name="heartbeatIntervalSeconds"
        type="range"
        min={PRESENCE.MIN_HEARTBEAT_INTERVAL}
        max={PRESENCE.MAX_HEARTBEAT_INTERVAL}
        step="30"
        bind:value={heartbeatInterval}
        class="interval-range"
      />
      <span class="interval-val faint">{heartbeatInterval}s</span>
    </div>

    <button class="btn btn-primary" type="submit">Save presence</button>
  </form>

  <h3 class="sub-h" style="margin-top: var(--space-5)">Devices</h3>
  <p class="muted small">
    Devices registered to receive push notifications. Register a device to enable
    notifications on it; remove devices you no longer use.
  </p>
  {#if form?.deviceRemoved}<p class="ok">Device removed.</p>{/if}
  {#if data.devices.length}
    <ul class="devices">
      {#each data.devices as device (device.id)}
        <li>
          <span class="dv">
            <strong>{device.name ?? device.platform}</strong>
            <!-- Show the platform label when a custom name is set so the entry
                 is still self-explaining without re-reading the name. -->
            {#if device.name}<span class="faint">({device.platform})</span>{/if}
            <span class="faint">Last seen {shortDate(device.lastSeenAt)}</span>
          </span>
          <form method="POST" action="?/deleteDevice" use:enhance>
            <input type="hidden" name="id" value={device.id} />
            <button class="btn rm" type="submit" aria-label="Remove device">×</button>
          </form>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted small">No devices registered.</p>
  {/if}
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
    {#if form?.resendError}<p class="error">{form.resendError}</p>{/if}
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
  .toggles { list-style: none; margin: var(--space-3) 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .toggles li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }
  .toggles label { margin: 0; }
  .toggles input { width: auto; }
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
  .sub-h { font-size: 0.95rem; margin: 0 0 var(--space-2); }
  .devices { list-style: none; margin: var(--space-3) 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .devices li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }
  .dv { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .dv .faint { font-size: 0.78rem; }
  .vis-row { display: flex; align-items: center; gap: var(--space-3); margin: var(--space-2) 0; }
  .vis-label { font-size: 0.88rem; color: var(--color-text-dim); white-space: nowrap; }
  .vis-row select { flex: 1; }
  .interval-row { display: flex; align-items: center; gap: var(--space-3); margin: var(--space-2) 0; }
  .interval-range { flex: 1; accent-color: var(--color-accent); }
  .interval-val { font-family: var(--mono); font-size: 0.82rem; min-width: 3ch; text-align: right; }
  .danger-h { color: var(--color-danger); font-size: 1rem; }
  .del { max-width: 360px; }
  .btn.danger { border-color: var(--color-danger); color: var(--color-danger); }
  .btn.danger:hover { background: var(--color-danger); color: #fff; }
</style>
