<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Notification settings: what you're notified about (per type) and browser
   * Web Push for this device. The push toggle does its PushManager work in the
   * browser, then hands the subscription to the server action so the access
   * token never touches client JS. `form` carries the save/error result back.
   */
  import { enhance } from '$app/forms';
  import { onMount } from 'svelte';
  import { NOTIFICATION_TYPES } from '@counter/config';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import type { NotificationType } from '@counter/config';
  import {
    subscribe as pushSubscribe,
    unsubscribe as pushUnsubscribe,
    isSubscribed,
    pushSupported,
  } from '$lib/push';

  let { data, form } = $props();

  // The human label for each notification toggle. Keyed by the type union so a
  // new notification type is a compile error here until it's given a label.
  const notifyLabels: Record<NotificationType, string> = {
    like: 'Likes',
    repost: 'Reposts',
    reply: 'Replies',
    follow: 'New followers',
    mention: 'Mentions',
    message: 'Direct messages',
    tunnel_invite: 'Tunnel Talk invites',
  };

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
</script>

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
          <Checkbox
            id="notify-{type}"
            name={type}
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
