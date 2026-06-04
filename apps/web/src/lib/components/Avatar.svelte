<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * A user's avatar, linking to their profile. Shows their picture when they
   * have one, otherwise falls back to the first letter of their name.
   *
   * Props:
   *   user  Just the bits we need to render and link: username, displayName,
   *         and avatarUrl. We take a narrow Pick so callers can hand us a
   *         partial user without owning a whole PublicUser.
   *   size  Edge length in pixels. Drives both the box and the initial's font
   *         size, so one number scales the whole thing.
   */
  import type { PublicUser } from '@counter/types';

  let {
    user,
    size = 44,
  }: { user: Pick<PublicUser, 'username' | 'displayName' | 'avatarUrl'>; size?: number } =
    $props();

  // Fallback glyph when there's no picture. Prefer the display name, fall back
  // to the username, and use '?' only if somehow both are empty.
  const initial = $derived((user.displayName || user.username || '?').charAt(0).toUpperCase());
</script>

<a href="/{user.username}" class="avatar" style="--s:{size}px" aria-label={user.username}>
  {#if user.avatarUrl}
    <img src={user.avatarUrl} alt={user.username} />
  {:else}
    <span>{initial}</span>
  {/if}
</a>

<style>
  /* An identity cell, not a bubble: square, bordered, initial set in mono. */
  .avatar {
    width: var(--s);
    height: var(--s);
    border-radius: var(--radius-sm);
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    background: var(--color-surface-strong);
    border: 1px solid var(--color-border-bright);
    color: var(--color-accent);
    overflow: hidden;
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  span {
    font-family: var(--mono);
    font-weight: 500;
    font-size: calc(var(--s) * 0.42);
  }
</style>
