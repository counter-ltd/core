<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Account settings: five tabs (Profile, Connections, Notifications, Privacy,
   * Account). Tab state is local — use:enhance keeps the page alive on submit
   * so the active tab survives form saves. OAuth redirects land on Connections.
   * `form` carries each action's save/error result back.
   */
  import { enhance } from '$app/forms';
  import { onMount } from 'svelte';
  import { setMode } from '$lib/theme';
  import { INTEGRATION_PLATFORMS } from '@counter/types';
  import { page } from '$app/state';
  import {
    subscribe as pushSubscribe,
    unsubscribe as pushUnsubscribe,
    isSubscribed,
    pushSupported,
  } from '$lib/push';

  const justConnected = $derived(page.url.searchParams.get('connected'));
  const oauthError = $derived(page.url.searchParams.get('oauthError'));
  import { NOTIFICATION_TYPES, PRESENCE, MESSAGING } from '@counter/config';
  import type { NotificationType, PresenceVisibility, MessagingPrivacy } from '@counter/config';
  let { data, form } = $props();
  const p = $derived(data.profile);

  // --- avatar upload ---
  // The picker uploads to /actions/upload and stashes the returned object id in
  // a hidden field; `avatarChanged` tells the profile action to apply it (so an
  // untouched avatar is never wiped on save). An empty id with avatarChanged set
  // means "remove the current avatar".
  let avatarObjectId = $state('');
  let avatarPreview = $state<string | null>(null);
  let avatarChanged = $state(false);
  let avatarUploading = $state(false);
  let avatarError = $state('');

  // What the preview shows: the just-picked image once changed, otherwise the
  // saved avatar. Null renders the empty placeholder.
  const avatarSrc = $derived(avatarChanged ? avatarPreview : (p.avatarUrl ?? null));

  /** Upload the picked image and point the avatar at it. */
  async function onPickAvatar(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    avatarError = '';
    avatarUploading = true;
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/actions/upload', { method: 'POST', body: form });
    const result = await res.json().catch(() => null);
    if (res.ok && result?.id) {
      avatarObjectId = result.id;
      // Preview from the local blob so it shows instantly, regardless of whether
      // the uploaded object is served yet (CDN propagation / local dev).
      avatarPreview = URL.createObjectURL(file);
      avatarChanged = true;
    } else {
      avatarError = result?.error ?? 'Upload failed.';
    }
    avatarUploading = false;
  }

  /** Clear the avatar; the unused object is swept later. */
  function removeAvatar() {
    avatarObjectId = '';
    avatarPreview = null;
    avatarChanged = true;
  }

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

  const messagingPrivacyLabels: Record<MessagingPrivacy, string> = {
    everyone: 'Everyone',
    followers: 'My followers only',
    nobody: 'No one',
  };

  const notifyLabels: Record<NotificationType, string> = {
    like: 'Likes',
    repost: 'Reposts',
    reply: 'Replies',
    follow: 'New followers',
    mention: 'Mentions',
    message: 'Direct messages',
    tunnel_invite: 'Tunnel Talk invites',
  };
  // The canonical profile URL a linked page must rel="me" back to. Matches what
  // the API checks (PUBLIC_WEB_URL/username), so the instruction shown here is
  // exactly the link that will verify.
  const profileUrl = $derived(`https://counter.ltd/${p.username}`);

  // Mirrors the range slider so the adjacent label stays in sync as the user
  // drags; the form value is still the canonical source on submit.
  let heartbeatInterval = $state(data.presenceSettings.heartbeatIntervalSeconds);

  // --- browser web push ---
  let pushSupportedState = $state(false);
  let pushOn = $state(false);
  let pushBusy = $state(false);
  let pushMsg = $state<string | null>(null);

  onMount(async () => {
    pushSupportedState = pushSupported();
    if (pushSupportedState) {
      try {
        pushOn = await isSubscribed();
      } catch {
        pushOn = false;
      }
    }
  });

  /** Subscribe this browser, then hand the subscription to the server action so
   *  the access token never touches client JS. */
  async function enablePush(): Promise<void> {
    if (pushBusy || !data.vapidPublicKey) return;
    pushBusy = true;
    pushMsg = null;
    try {
      const sub = await pushSubscribe(data.vapidPublicKey);
      if (!sub) {
        pushMsg = 'Notifications are blocked. Allow them in your browser settings, then try again.';
        return;
      }
      const fd = new FormData();
      fd.set('subscription', JSON.stringify(sub));
      const res = await fetch('?/subscribePush', {
        method: 'POST',
        body: fd,
        headers: { 'x-sveltekit-action': 'true' },
      });
      if (res.ok) pushOn = true;
      else pushMsg = 'Could not enable notifications.';
    } catch {
      pushMsg = 'Could not enable notifications.';
    } finally {
      pushBusy = false;
    }
  }

  /** Unsubscribe this browser and tell the server to drop the row. */
  async function disablePush(): Promise<void> {
    if (pushBusy) return;
    pushBusy = true;
    pushMsg = null;
    try {
      const endpoint = await pushUnsubscribe();
      if (endpoint) {
        const fd = new FormData();
        fd.set('endpoint', endpoint);
        await fetch('?/unsubscribePush', {
          method: 'POST',
          body: fd,
          headers: { 'x-sveltekit-action': 'true' },
        });
      }
      pushOn = false;
    } catch {
      pushMsg = 'Could not disable notifications.';
    } finally {
      pushBusy = false;
    }
  }

  const PLATFORM_LABELS: Record<string, string> = {
    website: 'Website',
    github: 'GitHub',
    discord: 'Discord',
    bandcamp: 'Bandcamp',
    soundcloud: 'SoundCloud',
    letterboxd: 'Letterboxd',
    goodreads: 'Goodreads',
    strava: 'Strava',
    itch: 'itch.io',
  };

  // Inline SVGs for platforms that have a recognisable mark; others fall back
  // to an empty string and the label alone identifies the platform.
  const PLATFORM_LOGOS: Record<string, string> = {
    github: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`,
    discord: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.114 18.1.133 18.115a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`,
  };

  function platformLabel(p: string): string {
    return PLATFORM_LABELS[p] ?? p;
  }

  function platformLogo(p: string): string {
    return PLATFORM_LOGOS[p] ?? '';
  }

  const hasUnverified = $derived(data.links.some((l) => !l.verified));

  type Tab = 'profile' | 'connections' | 'notifications' | 'integrations' | 'privacy' | 'account';

  // OAuth callbacks include ?connected or ?oauthError — land on Connections.
  let activeTab = $state<Tab>(justConnected || oauthError ? 'connections' : 'profile');

  // After a discordBot action the server returns updated settings; prefer those
  // over the load data so the toggle reflects the confirmed server state.
  const discordBotSettings = $derived(form?.discordBotSettings ?? data.discordBotSettings);
</script>

<svelte:head><title>Settings · Counter</title></svelte:head>

<h1 class="title">Settings</h1>

<nav class="tabs" aria-label="Settings sections">
  <button class="tab" class:active={activeTab === 'profile'}       onclick={() => activeTab = 'profile'}>Profile</button>
  <button class="tab" class:active={activeTab === 'connections'}   onclick={() => activeTab = 'connections'}>Connections</button>
  <button class="tab" class:active={activeTab === 'notifications'}  onclick={() => activeTab = 'notifications'}>Notifications</button>
  <button class="tab" class:active={activeTab === 'integrations'}  onclick={() => activeTab = 'integrations'}>Integrations</button>
  <button class="tab" class:active={activeTab === 'privacy'}       onclick={() => activeTab = 'privacy'}>Privacy</button>
  <button class="tab" class:active={activeTab === 'account'}       onclick={() => activeTab = 'account'}>Account</button>
</nav>

{#if activeTab === 'profile'}
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
      <span class="field-label">Avatar</span>
      <div class="avatar-row">
        {#if avatarSrc}
          <img class="avatar-preview" src={avatarSrc} alt="Your avatar" />
        {:else}
          <span class="avatar-preview empty" aria-hidden="true"></span>
        {/if}
        <div class="avatar-actions">
          <label class="btn btn-ghost">
            <input type="file" accept="image/*" onchange={onPickAvatar} hidden />
            {avatarUploading ? 'Uploading…' : 'Choose photo'}
          </label>
          {#if avatarSrc}
            <button type="button" class="btn btn-ghost" onclick={removeAvatar}>Remove</button>
          {/if}
        </div>
      </div>
      {#if avatarError}<p class="error">{avatarError}</p>{/if}
      <!-- Only carried to the server when the picker changed the avatar. -->
      {#if avatarChanged}
        <input type="hidden" name="avatarChanged" value="1" />
        <input type="hidden" name="avatarObjectId" value={avatarObjectId} />
      {/if}
    </div>
    <button class="btn btn-primary" type="submit" disabled={avatarUploading}>Save profile</button>
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
{/if}

{#if activeTab === 'connections'}
<section class="panel card">
  <h2>Connected accounts</h2>
  <p class="muted small">Connect GitHub or Discord to get a verified badge on your profile. OAuth-connected accounts verify automatically.</p>
  {#if justConnected}
    <p class="ok">{justConnected === 'github' ? 'GitHub' : 'Discord'} connected successfully.</p>
  {/if}
  {#if oauthError}
    <p class="error">{oauthError}</p>
  {/if}
  {#if form?.oauthError}<p class="error">{form.oauthError}</p>{/if}
  {#if form?.oauthDisconnected}<p class="ok">Disconnected.</p>{/if}

  <ul class="links">
    <li>
      <span class="lk">
        <span class="lk-name">
          <svg class="platform-logo" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          <strong>GitHub</strong>
        </span>
        {#if data.githubAccount}
          <span class="faint url">@{data.githubAccount.providerUsername}</span>
          <span class="badge">✦ connected</span>
        {:else}
          <span class="faint">Not connected</span>
        {/if}
      </span>
      <span class="lk-actions">
        {#if data.githubAccount}
          <form method="POST" action="?/disconnectOAuth" use:enhance>
            <input type="hidden" name="provider" value="github" />
            <button class="btn rm" type="submit">Disconnect</button>
          </form>
        {:else}
          <!-- Plain form (no use:enhance) so the browser follows the external redirect to GitHub. -->
          <form method="POST" action="?/connectOAuth">
            <input type="hidden" name="provider" value="github" />
            <button class="btn" type="submit">Connect</button>
          </form>
        {/if}
      </span>
    </li>
    <li>
      <span class="lk">
        <span class="lk-name">
          <svg class="platform-logo" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026c.462-.62.874-1.275 1.226-1.963.021-.04.001-.088-.041-.104a13.201 13.201 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028zM8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38 0-1.312.956-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.956 2.38-2.157 2.38zm7.975 0c-1.183 0-2.157-1.069-2.157-2.38 0-1.312.955-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.946 2.38-2.157 2.38z"/>
          </svg>
          <strong>Discord</strong>
        </span>
        {#if data.discordAccount}
          <span class="faint url">@{data.discordAccount.providerUsername}</span>
          <span class="badge">✦ connected</span>
        {:else}
          <span class="faint">Not connected</span>
        {/if}
      </span>
      <span class="lk-actions">
        {#if data.discordAccount}
          <form method="POST" action="?/disconnectOAuth" use:enhance>
            <input type="hidden" name="provider" value="discord" />
            <button class="btn rm" type="submit">Disconnect</button>
          </form>
        {:else}
          <form method="POST" action="?/connectOAuth">
            <input type="hidden" name="provider" value="discord" />
            <button class="btn" type="submit">Connect</button>
          </form>
        {/if}
      </span>
    </li>
  </ul>
</section>

<section class="panel card">
  <h2>Badges</h2>
  <p class="muted small">
    Verified platform connections earn badges you can show on your profile.
    Toggle each one to control what visitors see.
  </p>
  {#if form?.badgeError}<p class="error">{form.badgeError}</p>{/if}
  {#if form?.linkError}<p class="error">{form.linkError}</p>{/if}
  {#if form?.linkVerified}<p class="ok">Verified. Badge is now on your profile.</p>{/if}
  {#if form?.linkUnverified}
    <p class="error">No <code>rel="me"</code> link back to your profile found on that page yet.</p>
  {/if}

  {#if data.links.length}
    <ul class="links">
      {#each data.links as link (link.id)}
        <li>
          <span class="lk">
            <span class="lk-name">
              <!-- SVG logo uses fill="currentColor" so it inherits the row's text color. -->
              {@html platformLogo(link.platform)}
              <strong>{platformLabel(link.platform)}</strong>
              {#if link.username}
                <span class="faint mono">@{link.username}</span>
              {/if}
            </span>
            {#if !link.verified}
              <a href={link.url} target="_blank" rel="noopener" class="faint url">{link.url}</a>
            {/if}
          </span>
          <span class="lk-actions">
            {#if link.verified}
              <form method="POST" action="?/toggleBadge" use:enhance>
                <input type="hidden" name="id" value={link.id} />
                <input type="hidden" name="displayed" value={String(!link.displayed)} />
                <button class="btn" type="submit">{link.displayed ? 'Hide' : 'Show'}</button>
              </form>
            {:else}
              <form method="POST" action="?/verifyLink" use:enhance>
                <input type="hidden" name="id" value={link.id} />
                <button class="btn" type="submit">Verify</button>
              </form>
            {/if}
            <form method="POST" action="?/removeLink" use:enhance>
              <input type="hidden" name="id" value={link.id} />
              <button class="btn rm" type="submit" aria-label="Remove">×</button>
            </form>
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  <!-- Show rel="me" instructions only when there's something to verify. -->
  {#if hasUnverified}
    <p class="muted small verify-hint">
      To verify a link, add <code>rel="me"</code> pointing to
      <span class="faint">{profileUrl}</span> on the linked page, then click Verify.
    </p>
  {/if}

  <form method="POST" action="?/addLink" use:enhance class="add-link">
    <select name="platform" aria-label="Platform">
      {#each INTEGRATION_PLATFORMS as platform (platform)}
        <option value={platform}>{platformLabel(platform)}</option>
      {/each}
    </select>
    <input name="url" type="url" placeholder="https://…" required />
    <button class="btn" type="submit">Add</button>
  </form>
</section>
{/if}

{#if activeTab === 'notifications'}
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

{#if pushSupportedState && data.vapidPublicKey}
<section class="panel card">
  <h2>Browser notifications</h2>
  <p class="muted small">
    Get notified on this device when you're not on the page. Thin by design: the
    alert shows the type only, never the sender or the message.
  </p>
  {#if pushMsg}<p class="error">{pushMsg}</p>{/if}
  {#if pushOn}
    <button class="btn" onclick={disablePush} disabled={pushBusy}>
      {pushBusy ? 'Working…' : 'Disable on this device'}
    </button>
  {:else}
    <button class="btn btn-primary" onclick={enablePush} disabled={pushBusy}>
      {pushBusy ? 'Working…' : 'Enable on this device'}
    </button>
  {/if}
</section>
{/if}
{/if}

{#if activeTab === 'integrations'}
<section class="panel card">
  <h2>Integrations</h2>

  <div class="integration-row">
    <span class="lk-name">
      <!-- Discord logo -->
      <svg class="platform-logo" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.114 18.1.133 18.115a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
      </svg>
      <strong>Thing Two</strong>
      {#if discordBotSettings?.enabled}
        <span class="badge">✦ active</span>
      {/if}
    </span>
    {#if form?.discordBotErrorCode === 'not_in_guild'}
      <p class="error">
        {form.discordBotError}
        <a href="https://discord.gg/MxNhac7fz3" target="_blank" rel="noopener noreferrer">Join the Counter server</a>
        then try again.
      </p>
    {:else if form?.discordBotError}
      <p class="error">{form.discordBotError}</p>
    {/if}

    {#if !data.discordAccount}
      <!-- Can't enable either toggle until Discord is linked. -->
      <p class="small muted">
        <button class="btn-link" onclick={() => activeTab = 'connections'}>Connect your Discord account</button>
        to enable Thing Two.
      </p>
    {:else}
      <div class="thing-two-toggles">
        <div class="thing-two-row">
          <div class="thing-two-row-label">
            <span class="small">Notifications</span>
            <span class="small muted">Receive Counter notifications as Discord DMs. Requires Counter server membership.</span>
          </div>
          <form method="POST" action="?/discordBot" use:enhance class="integration-toggle">
            <input type="hidden" name="enabled" value={discordBotSettings?.enabled ? 'false' : 'true'} />
            <button class="btn btn-sm" type="submit">
              {discordBotSettings?.enabled ? 'Disable' : 'Enable'}
            </button>
            {#if !discordBotSettings?.enabled && !discordBotSettings?.inGuild}
              <span class="small muted">Not in our server? <a href="https://discord.gg/MxNhac7fz3" target="_blank" rel="noopener noreferrer">Join here</a></span>
            {/if}
          </form>
        </div>

        <div class="thing-two-row">
          <div class="thing-two-row-label">
            <span class="small">Post from Discord</span>
            <span class="small muted">Use <code>/post</code> or right-click → "Share to Counter" to post directly from Discord.</span>
          </div>
          <form method="POST" action="?/discordBot" use:enhance class="integration-toggle">
            <!-- Carry the current notifications state so toggling posting doesn't reset it. -->
            <input type="hidden" name="enabled" value={discordBotSettings?.enabled ? 'true' : 'false'} />
            <input type="hidden" name="postingEnabled" value={discordBotSettings?.postingEnabled ? 'false' : 'true'} />
            <button class="btn btn-sm" type="submit">
              {discordBotSettings?.postingEnabled ? 'Disable' : 'Enable'}
            </button>
          </form>
        </div>
      </div>
    {/if}
  </div>
</section>
{/if}

{#if activeTab === 'privacy'}
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

    <h3 class="sub-h" style="margin-top: var(--space-4)">Typing indicators</h3>
    <p class="muted small">
      Let the person you're chatting with see when you're typing. On by default.
      Turning this off stops your typing from being sent; the indicator is never
      stored.
    </p>
    <ul class="toggles">
      <li>
        <label for="typingIndicatorsEnabled">Send typing indicators</label>
        <input
          id="typingIndicatorsEnabled"
          name="typingIndicatorsEnabled"
          type="checkbox"
          checked={data.presenceSettings.typingIndicatorsEnabled}
        />
      </li>
    </ul>

    <button class="btn btn-primary" type="submit">Save presence</button>
  </form>

  <h3 class="sub-h" style="margin-top: var(--space-5)">Messages</h3>
  <p class="muted small">
    Control who can send you a direct message. When set to "My followers only", anyone
    else can still send you one message request — you can accept or decline it.
    "No one" blocks all incoming messages and requests.
  </p>
  {#if form?.messagingSaved}<p class="ok">Saved.</p>{/if}
  {#if form?.messagingError}<p class="error">{form.messagingError}</p>{/if}
  <form method="POST" action="?/messaging" use:enhance class="stack">
    <div class="vis-row">
      <label for="messagingPrivacy" class="vis-label">Who can message me</label>
      <select id="messagingPrivacy" name="messagingPrivacy">
        {#each MESSAGING.PRIVACY_OPTIONS as opt (opt)}
          <option value={opt} selected={data.presenceSettings.messagingPrivacy === opt}>
            {messagingPrivacyLabels[opt]}
          </option>
        {/each}
      </select>
    </div>
    <button class="btn btn-primary" type="submit">Save</button>
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
{/if}

{#if activeTab === 'account'}
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
{/if}

<style>
  .field-label {
    display: block;
    margin-bottom: var(--space-2);
    font-size: 0.85rem;
    color: var(--color-text-muted, var(--color-text));
  }
  .avatar-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .avatar-preview {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--color-border);
  }
  .avatar-preview.empty {
    display: inline-block;
    background: var(--color-bg-2, var(--color-surface));
  }
  .avatar-actions {
    display: flex;
    gap: var(--space-2);
  }
  /* Ghost button used by the avatar picker; subtle, bordered, not the primary. */
  .btn-ghost {
    background: transparent;
    border: 1px solid var(--color-border);
    cursor: pointer;
  }
  .title { margin-bottom: var(--space-3); }
  .tabs { display: flex; gap: 0; margin-bottom: var(--space-4); flex-wrap: wrap; }
  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-dim);
    cursor: pointer;
    font-size: 0.88rem;
    transition: color 0.15s, border-bottom-color 0.15s;
  }
  .tab:hover { color: var(--color-text); }
  .tab.active { color: var(--color-accent); border-bottom-color: var(--color-accent); }
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
  .lk-name { display: inline-flex; align-items: center; gap: var(--space-2); }
  /* The logo inherits the row's text color via fill="currentColor". */
  .platform-logo { flex-shrink: 0; opacity: 0.85; }
  .lk .url { font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
  .lk-actions { display: flex; align-items: center; gap: var(--space-2); }
  .lk-actions form { margin: 0; }
  .btn.rm { padding: 0.1em 0.5em; }
  .add-link { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .add-link select, .add-link input { flex: 1; min-width: 120px; }
  .verify-hint { margin: var(--space-2) 0; }
  .mono { font-family: var(--mono); font-size: 0.82rem; }
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
  .integration-row { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3) 0; }
  .integration-toggle { display: flex; align-items: center; gap: var(--space-3); }
  .thing-two-toggles { display: flex; flex-direction: column; gap: var(--space-2); }
  .thing-two-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-2) 0; border-top: 1px solid var(--color-border); }
  .thing-two-row-label { display: flex; flex-direction: column; gap: var(--space-1); }
  .btn-sm { padding: var(--space-1) var(--space-3); font-size: var(--text-sm); }
  .btn-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--color-accent);
    cursor: pointer;
    font-size: inherit;
    text-decoration: underline;
  }
</style>
