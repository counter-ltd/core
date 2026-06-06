<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Connections settings: link GitHub/Discord for an auto-verified badge, and
   * manage rel="me" links to other platforms. OAuth callbacks land here with
   * ?connected or ?oauthError in the URL, which is why this page reads them.
   * `form` carries each action's result back.
   */
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { INTEGRATION_PLATFORMS } from '@counter/types';
  import Select from '$lib/components/Select.svelte';

  let { data, form } = $props();
  const p = $derived(data.profile);

  const justConnected = $derived(page.url.searchParams.get('connected'));
  const oauthError = $derived(page.url.searchParams.get('oauthError'));

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

  function platformLabel(platform: string): string {
    return PLATFORM_LABELS[platform] ?? platform;
  }

  function platformLogo(platform: string): string {
    return PLATFORM_LOGOS[platform] ?? '';
  }

  const hasUnverified = $derived(data.links.some((l) => !l.verified));

  // The canonical profile URL a linked page must rel="me" back to. Matches what
  // the API checks (PUBLIC_WEB_URL/username), so the instruction shown here is
  // exactly the link that will verify.
  const profileUrl = $derived(`https://counter.ltd/${p.username}`);
</script>

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
    <Select
      name="platform"
      aria-label="Platform"
      value={INTEGRATION_PLATFORMS[0]}
      options={INTEGRATION_PLATFORMS.map(p => ({value: p, label: platformLabel(p)}))}
    />
    <input name="url" type="url" placeholder="https://…" required />
    <button class="btn" type="submit">Add</button>
  </form>
</section>

<style>
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
  .add-link :global(.select), .add-link input { flex: 1; min-width: 120px; }
  .verify-hint { margin: var(--space-2) 0; }
  .mono { font-family: var(--mono); font-size: 0.82rem; }
</style>
