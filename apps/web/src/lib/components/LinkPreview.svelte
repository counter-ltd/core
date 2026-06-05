<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * OG/meta link preview card. Fetches preview data server-side via the
   * /preview proxy so the user's IP never reaches the target site and CORS
   * is a non-issue. Rendered below a message bubble when the body contains
   * a URL.
   *
   * Two layouts:
   * - Full (single URL): hero image + site name + title + description.
   * - Compact (multiple URLs): single-row chip — site name and title only,
   *   no image. Keeps multi-link messages from becoming wall-of-cards.
   *
   * Clicking the card shows a brief external-link warning before opening
   * in a new tab so the user always knows where they're going.
   */
  import { onMount } from 'svelte';
  import type { LinkPreview } from '@counter/types';

  let {
    url,
    apiUrl,
    accessToken,
    compact = false,
  }: {
    url: string;
    apiUrl: string;
    accessToken: string | null;
    compact?: boolean;
  } = $props();

  let preview = $state<LinkPreview | null>(null);
  let loading = $state(true);
  // When true, the warning overlay replaces the card face before opening.
  let showWarning = $state(false);

  onMount(async () => {
    try {
      const res = await fetch(
        `${apiUrl}/preview?url=${encodeURIComponent(url)}`,
        accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
      );
      if (res.ok) preview = (await res.json()) as LinkPreview;
    } catch {
      // Network failure — card stays hidden.
    } finally {
      loading = false;
    }
  });

  /** Hostname shown in the warning and compact chip ("github.com"). */
  const domain = $derived.by(() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  });

  const displaySite = $derived(preview?.siteName || domain);

  function handleCardClick(e: MouseEvent) {
    e.preventDefault();
    showWarning = true;
  }

  function visitSite() {
    window.open(url, '_blank', 'noopener,noreferrer');
    showWarning = false;
  }
</script>

{#if !loading && preview && (preview.title || preview.description)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="preview panel"
    class:compact
    onclick={handleCardClick}
    role="link"
    tabindex="0"
    onkeydown={(e) => e.key === 'Enter' && handleCardClick(e as unknown as MouseEvent)}
  >
    {#if showWarning}
      <div class="warning-overlay" role="alertdialog" aria-label="External link warning">
        <p class="warning-domain">{domain}</p>
        <p class="warning-msg">Opens an external site in a new tab.</p>
        <div class="warning-btns">
          <button class="btn btn-sm btn-primary" onclick={visitSite}>Visit site</button>
          <button class="btn btn-sm" onclick={(e) => { e.stopPropagation(); showWarning = false; }}>
            Cancel
          </button>
        </div>
      </div>
    {:else if compact}
      <!-- Compact: single-row chip, no image. -->
      <div class="chip">
        <span class="chip-site faint">{displaySite}</span>
        {#if preview.title}
          <span class="chip-title">{preview.title}</span>
        {/if}
      </div>
    {:else}
      <!-- Full: hero image + stacked info. -->
      {#if preview.image}
        <img class="preview-image" src={preview.image} alt="" loading="lazy" />
      {/if}
      <div class="preview-body">
        <span class="preview-site faint">{displaySite}</span>
        {#if preview.title}
          <p class="preview-title">{preview.title}</p>
        {/if}
        {#if preview.description}
          <p class="preview-desc faint">{preview.description}</p>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .preview {
    cursor: pointer;
    overflow: hidden;
    padding: 0;
    margin-top: var(--space-2);
    transition: border-color 0.15s;
    display: block;
  }

  .preview:hover {
    border-color: var(--color-border-bright);
  }

  /* --- Full layout --- */

  .preview-image {
    width: 100%;
    max-height: 160px;
    object-fit: cover;
    display: block;
    background: var(--color-surface-strong);
  }

  .preview-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-2) var(--space-3);
  }

  .preview-site {
    font-family: var(--mono);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .preview-title {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 500;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .preview-desc {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* --- Compact layout --- */

  .preview.compact {
    margin-top: var(--space-1);
  }

  .chip {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: 5px var(--space-3);
    min-width: 0;
  }

  .chip-site {
    font-family: var(--mono);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .chip-title {
    font-size: 0.82rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  /* --- Warning overlay --- */

  .warning-overlay {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .warning-domain {
    margin: 0;
    font-family: var(--mono);
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--color-text);
    word-break: break-all;
  }

  .warning-msg {
    margin: 0;
    font-size: 0.8rem;
    color: var(--color-text-dim);
  }

  .warning-btns {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  .btn-sm {
    padding: 3px 10px;
    font-size: 0.78rem;
  }
</style>
