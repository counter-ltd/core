<script lang="ts">
  /**
   * Renders a Discord message that was shared to Counter via "Share to Counter".
   *
   * Shows the quoted content in a styled card with a Discord logo badge. The
   * author name links to their Counter profile if connected, otherwise to their
   * Discord profile with an external-link warning so the user always knows where
   * they're headed before leaving the app.
   */
  import type { DiscordShareMeta } from '@counter/types';

  let { meta }: { meta: DiscordShareMeta } = $props();

  const discordProfileUrl = `https://discord.com/users/${meta.authorDiscordId}`;
  const discordHandle = meta.authorDiscordTag
    ? `${meta.authorName}#${meta.authorDiscordTag}`
    : meta.authorName;

  // When the author has no Counter account, clicking the Discord link shows a
  // one-click warning overlay (same pattern as link previews) before opening.
  let showExternalWarning = $state(false);

  function handleDiscordLinkClick(e: MouseEvent) {
    if (!showExternalWarning) {
      e.preventDefault();
      showExternalWarning = true;
    }
    // Second click: let the default <a> open in a new tab.
  }
</script>

<div class="discord-card">
  <!-- Discord logo badge, top-right -->
  <svg class="discord-badge" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-label="Shared from Discord">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.114 18.1.133 18.115a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
  </svg>

  <p class="discord-content">{meta.content}</p>

  <div class="discord-attribution">
    <!-- The author's Discord avatar, ingested into our own storage on share.
         Absent on default avatars or pre-avatar shares; fall back to the dash. -->
    {#if meta.authorAvatarUrl}
      <img class="discord-avatar" src={meta.authorAvatarUrl} alt="" />
    {:else}
      <span class="discord-attr-dash">—</span>
    {/if}
    {#if meta.authorCounterUsername}
      <!-- Author has a Counter account: "TheSam#1234 (@counteruser)" -->
      <a
        href={discordProfileUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="discord-author external"
        onclick={handleDiscordLinkClick}
      >{discordHandle}</a>
      {#if showExternalWarning}
        <span class="external-warning">discord.com — tap again to open</span>
      {:else}
        (<a href="/{meta.authorCounterUsername}" class="counter-author">@{meta.authorCounterUsername}</a>)
      {/if}
    {:else}
      <!-- Author is Discord-only: "TheSam#1234 on Discord" with external warning -->
      <a
        href={discordProfileUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="discord-author external"
        onclick={handleDiscordLinkClick}
      >{discordHandle}</a>
      {#if showExternalWarning}
        <span class="external-warning">discord.com — tap again to open</span>
      {:else}
        <span class="discord-source-label">on Discord</span>
      {/if}
    {/if}
  </div>
</div>

<style>
  .discord-card {
    position: relative;
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, #5865f2 20%);
    border-left: 3px solid #5865f2;
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
    /* Match the gap a reposted (nested) card leaves below the author header,
       so an embed and a repost line up the same way under the profile picture. */
    margin-top: var(--space-3);
    background: color-mix(in srgb, var(--color-surface) 95%, #5865f2 5%);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .discord-badge {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
    color: #5865f2;
    opacity: 0.7;
    flex-shrink: 0;
  }

  .discord-content {
    font-size: var(--text-sm);
    color: var(--color-text);
    line-height: 1.5;
    margin: 0;
    /* Prevent overlong messages from blowing out the card layout. */
    overflow-wrap: break-word;
  }

  .discord-attribution {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-muted);
  }

  .discord-author {
    color: var(--color-accent);
    text-decoration: none;
    font-weight: 500;
  }

  .discord-author:hover { text-decoration: underline; }

  .discord-author.external { position: relative; }

  .external-warning {
    display: inline-block;
    margin-left: var(--space-1);
    color: var(--color-muted);
    font-weight: 400;
  }

  .discord-source-label { color: var(--color-muted); }

  .discord-attr-dash { color: var(--color-muted); }

  .discord-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .counter-author {
    color: var(--color-accent);
    text-decoration: none;
    font-weight: 500;
  }

  .counter-author:hover { text-decoration: underline; }
</style>
