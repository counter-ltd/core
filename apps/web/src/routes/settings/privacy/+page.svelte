<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Privacy settings: presence (online status, last seen, heartbeat, typing),
   * who can message you, and your registered push devices. Presence and
   * messaging save through separate forms so each can fail on its own. `form`
   * carries each action's result back.
   */
  import { enhance } from '$app/forms';
  import { PRESENCE, MESSAGING } from '@counter/config';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Select from '$lib/components/Select.svelte';
  import type { PresenceVisibility, MessagingPrivacy } from '@counter/config';

  let { data, form } = $props();

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

  // Mirrors the range slider so the adjacent label stays in sync as the user
  // drags; the form value is still the canonical source on submit.
  let heartbeatInterval = $state(data.presenceSettings.heartbeatIntervalSeconds);

  /** Format an ISO date string as a short human-readable date. */
  function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
</script>

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
        <Checkbox
          id="onlineStatusEnabled"
          name="onlineStatusEnabled"
          checked={data.presenceSettings.onlineStatusEnabled}
        />
      </li>
    </ul>
    <div class="vis-row">
      <label for="onlineStatusVisibility" class="vis-label">Visible to</label>
      <Select
        id="onlineStatusVisibility"
        name="onlineStatusVisibility"
        value={data.presenceSettings.onlineStatusVisibility}
        options={PRESENCE.VISIBILITY_OPTIONS.map(opt => ({value: opt, label: visibilityLabels[opt]}))}
      />
    </div>

    <h3 class="sub-h" style="margin-top: var(--space-4)">Last seen</h3>
    <p class="muted small">Show how long ago you were last active. Off by default.</p>
    <ul class="toggles">
      <li>
        <label for="lastSeenEnabled">Show last seen</label>
        <Checkbox
          id="lastSeenEnabled"
          name="lastSeenEnabled"
          checked={data.presenceSettings.lastSeenEnabled}
        />
      </li>
    </ul>
    <div class="vis-row">
      <label for="lastSeenVisibility" class="vis-label">Visible to</label>
      <Select
        id="lastSeenVisibility"
        name="lastSeenVisibility"
        value={data.presenceSettings.lastSeenVisibility}
        options={PRESENCE.VISIBILITY_OPTIONS.map(opt => ({value: opt, label: visibilityLabels[opt]}))}
      />
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
        <Checkbox
          id="typingIndicatorsEnabled"
          name="typingIndicatorsEnabled"
          checked={data.presenceSettings.typingIndicatorsEnabled}
        />
      </li>
    </ul>

    <button class="btn btn-primary" type="submit">Save presence</button>
  </form>
</section>

<section class="panel card">
  <h2>Messages</h2>
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
      <Select
        id="messagingPrivacy"
        name="messagingPrivacy"
        value={data.presenceSettings.messagingPrivacy}
        options={MESSAGING.PRIVACY_OPTIONS.map(opt => ({value: opt, label: messagingPrivacyLabels[opt]}))}
      />
    </div>
    <button class="btn btn-primary" type="submit">Save</button>
  </form>
</section>

<section class="panel card">
  <h2>Devices</h2>
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

<style>
  .sub-h { font-size: 0.95rem; margin: 0 0 var(--space-2); }
  .vis-row { display: flex; align-items: center; gap: var(--space-3); margin: var(--space-2) 0; }
  .vis-label { font-size: 0.88rem; color: var(--color-text-dim); white-space: nowrap; }
  .vis-row :global(.select) { flex: 1; }
  .interval-row { display: flex; align-items: center; gap: var(--space-3); margin: var(--space-2) 0; }
  .interval-range { flex: 1; accent-color: var(--color-accent); }
  .interval-val { font-family: var(--mono); font-size: 0.82rem; min-width: 3ch; text-align: right; }
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
  .btn.rm { padding: 0.1em 0.5em; }
</style>
