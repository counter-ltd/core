<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The "create a topic" form at /topics/new.
   *
   * Submits through `use:enhance` so a failed create comes back as `form` data
   * over fetch instead of a full reload. That keeps the URL clean and dodges the
   * browser's resubmit-on-refresh dialog.
   */
  import { enhance } from '$app/forms';
  import type { ActionData } from './$types';
  let { form }: { form: ActionData } = $props();
</script>

<svelte:head><title>New topic · Counter</title></svelte:head>

<a href="/topics" class="back faint">← /topics</a>

<div class="panel create-form">
  <h1 class="title">Create a topic</h1>

  {#if form?.error}
    <p class="error">{form.error}</p>
  {/if}

  <form method="POST" use:enhance>
    <label class="field">
      <span class="label">Slug <span class="faint">(URL identifier, e.g. photography)</span></span>
      <input
        type="text"
        name="slug"
        required
        minlength="2"
        maxlength="50"
        pattern="[a-z][a-z0-9_-]*"
        placeholder="photography"
        value={form?.slug ?? ''}
        autofocus
      />
      <span class="hint faint">Lowercase letters, digits, hyphens, underscores. Cannot be changed.</span>
    </label>

    <label class="field">
      <span class="label">Display name</span>
      <input
        type="text"
        name="name"
        required
        maxlength="100"
        placeholder="Photography"
        value={form?.name ?? ''}
      />
    </label>

    <label class="field">
      <span class="label">Description <span class="faint">(optional)</span></span>
      <textarea name="description" maxlength="500" placeholder="What's this topic about?">{form?.description ?? ''}</textarea>
    </label>

    <div class="actions">
      <button class="btn btn-primary" type="submit">Create topic</button>
      <a class="btn" href="/topics">Cancel</a>
    </div>
  </form>
</div>

<style>
  .back {
    display: inline-block;
    font-family: var(--mono);
    font-size: 0.82rem;
    margin-bottom: var(--space-4);
  }
  .back:hover { text-decoration: underline; }
  .create-form {
    padding: var(--space-5);
    max-width: 520px;
  }
  .title { margin: 0 0 var(--space-5); font-size: 1.2rem; }
  form { display: flex; flex-direction: column; gap: var(--space-4); }
  .field { display: flex; flex-direction: column; gap: var(--space-2); }
  .label { font-size: 0.85rem; font-weight: 500; }
  .hint { font-size: 0.78rem; }
  .error {
    color: var(--color-error, #e53);
    font-size: 0.88rem;
    padding: var(--space-3);
    background: color-mix(in srgb, var(--color-error, #e53) 10%, transparent);
    border-radius: var(--radius-sm, 4px);
    margin-bottom: var(--space-2);
  }
  .actions { display: flex; gap: var(--space-3); margin-top: var(--space-2); }
</style>
