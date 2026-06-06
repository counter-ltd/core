<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Integrations settings: the Thing Two Discord bot. Two independent toggles
   * (notification DMs, and posting to Counter from Discord), both gated on
   * having a linked Discord account. `form` carries the bot action's result,
   * including the confirmed server-side settings, back to the page.
   */
  import { enhance } from '$app/forms';

  let { data, form } = $props();

  // After a discordBot action the server returns updated settings; prefer those
  // over the load data so the toggle reflects the confirmed server state.
  const discordBotSettings = $derived(form?.discordBotSettings ?? data.discordBotSettings);
</script>

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
        <a href="/discord" target="_blank" rel="noopener noreferrer">Join the Counter server</a>
        then try again.
      </p>
    {:else if form?.discordBotError}
      <p class="error">{form.discordBotError}</p>
    {/if}

    {#if !data.discordAccount}
      <!-- Can't enable either toggle until Discord is linked. -->
      <p class="small muted">
        <a href="/settings/connections">Connect your Discord account</a>
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
              <span class="small muted">Not in our server? <a href="/discord" target="_blank" rel="noopener noreferrer">Join here</a></span>
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

<style>
  .lk-name { display: inline-flex; align-items: center; gap: var(--space-2); }
  .platform-logo { flex-shrink: 0; opacity: 0.85; }
  .integration-row { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3) 0; }
  .integration-toggle { display: flex; align-items: center; gap: var(--space-3); }
  .thing-two-toggles { display: flex; flex-direction: column; gap: var(--space-2); }
  .thing-two-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-2) 0; border-top: 1px solid var(--color-border); }
  .thing-two-row-label { display: flex; flex-direction: column; gap: var(--space-1); }
  .btn-sm { padding: var(--space-1) var(--space-3); font-size: var(--text-sm); }
</style>
