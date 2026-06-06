<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Profile settings: display name, bio, avatar, and the light/dark mode
   * switch. The avatar uploads out-of-band to /actions/upload and only the
   * returned object id rides along on save, so an untouched avatar is never
   * wiped. `form` carries the profile action's save/error result back.
   */
  import { enhance } from '$app/forms';
  import { setMode } from '$lib/theme';

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
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/actions/upload', { method: 'POST', body: fd });
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
</script>

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
</style>
