<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The box you type a post into. It's a plain form that POSTs to the compose
   * action, so it works without JS; the only client-side touch is the live
   * character count and disabling submit while empty.
   *
   * Props:
   *   parentId     Set when this is a reply, so the server threads it under that
   *                post. Null for a top-level post.
   *   topicId      Set when posting into a specific topic. Null otherwise.
   *   redirectTo   Where the server sends you back to after posting. Defaults to
   *                the feed; reply forms pass the thread they live on so you
   *                land back where you were.
   *   placeholder  Prompt text in the empty textarea.
   *   cta          Label on the submit button ("Post", "Reply", etc).
   */
  import { POST } from '@counter/config';

  let {
    parentId = null,
    topicId = null,
    topics = null,
    redirectTo = '/feed',
    placeholder = "What's happening?",
    cta = 'Post',
  }: {
    parentId?: string | null;
    topicId?: string | null;
    /** When provided, shows a topic selector in the bar. */
    topics?: Array<{ id: string; slug: string; name: string }> | null;
    redirectTo?: string;
    placeholder?: string;
    cta?: string;
  } = $props();

  let value = $state('');
  // Track selected topic separately so the hidden input reflects the select.
  let selectedTopicId = $state(topicId ?? '');

  // Attached photos, in display order. Each is uploaded the moment it's picked
  // (to /actions/upload) so by submit time we already hold its object id; the
  // form just carries those ids in hidden inputs. `preview` is a local blob URL
  // so the thumbnail renders instantly and doesn't depend on the uploaded object
  // being served yet (CDN/DNS propagation, or local dev where it isn't served).
  type Attachment = { id: string; preview: string };
  let attachments = $state<Attachment[]>([]);
  let uploading = $state(false);
  let uploadError = $state('');

  const MAX_MEDIA = 4;

  /** Upload a batch of files, appending the ones that succeed up to the cap. */
  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    uploadError = '';
    uploading = true;
    for (const file of files) {
      if (attachments.length >= MAX_MEDIA) {
        uploadError = `Up to ${MAX_MEDIA} photos.`;
        break;
      }
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/actions/upload', { method: 'POST', body: form });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.id) {
        attachments = [...attachments, { id: data.id, preview: URL.createObjectURL(file) }];
      } else {
        uploadError = data?.error ?? 'Upload failed.';
      }
    }
    uploading = false;
  }

  /** Handle the file picker: upload the chosen files, then reset the input. */
  async function onPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    // Clear the input so re-picking the same file still fires a change event.
    input.value = '';
    await uploadFiles(files);
  }

  /** Handle Cmd/Ctrl-V (or any paste) that carries images: upload them inline. */
  async function onPaste(event: ClipboardEvent) {
    const items = Array.from(event.clipboardData?.items ?? []);
    const files = items
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (!files.length) return;
    // Stop the image (or its file path) from also landing as text in the body.
    event.preventDefault();
    await uploadFiles(files);
  }

  /** Drop an attachment before submit. The uploaded object is swept later if unused. */
  function removeAt(index: number) {
    // Free the blob URL we created for the preview so it doesn't leak.
    URL.revokeObjectURL(attachments[index]?.preview ?? '');
    attachments = attachments.filter((_, i) => i !== index);
  }
</script>

<form method="POST" action="/actions/compose" class="composer panel">
  {#if parentId}<input type="hidden" name="parentId" value={parentId} />{/if}
  <!-- When a selector is shown the <select> provides the topicId value directly.
       When the topic is pre-scoped (topic page), use a hidden input instead. -->
  {#if !topics && topicId}
    <input type="hidden" name="topicId" value={topicId} />
  {/if}
  <input type="hidden" name="redirectTo" value={redirectTo} />
  <!-- One hidden field per uploaded photo; the compose action reads these back. -->
  {#each attachments as a (a.id)}
    <input type="hidden" name="mediaObjectId" value={a.id} />
  {/each}
  <textarea
    name="body"
    {placeholder}
    maxlength={POST.MAX_BODY_LENGTH}
    bind:value
    onpaste={onPaste}
  ></textarea>

  {#if attachments.length > 0}
    <div class="thumbs">
      {#each attachments as a, i (a.id)}
        <div class="thumb">
          <img src={a.preview} alt="" />
          <button type="button" class="remove" onclick={() => removeAt(i)} aria-label="Remove photo">×</button>
        </div>
      {/each}
    </div>
  {/if}
  {#if uploadError}<p class="upload-error">{uploadError}</p>{/if}

  <div class="bar">
    {#if topics && topics.length > 0}
      <select
        name="topicId"
        class="topic-select"
        bind:value={selectedTopicId}
      >
        <option value="">No topic</option>
        {#each topics as t (t.id)}
          <option value={t.id}>{t.name}</option>
        {/each}
      </select>
    {:else}
      <span class="faint count">{value.length}/{POST.MAX_BODY_LENGTH}</span>
    {/if}
    <div class="right">
      {#if topics && topics.length > 0}
        <span class="faint count">{value.length}/{POST.MAX_BODY_LENGTH}</span>
      {/if}
      <label class="photo-btn" class:disabled={attachments.length >= MAX_MEDIA}>
        <input
          type="file"
          accept="image/*"
          multiple
          onchange={onPick}
          disabled={attachments.length >= MAX_MEDIA}
        />
        {uploading ? '…' : '📷'}
      </label>
      <button
        class="btn btn-primary"
        type="submit"
        disabled={(value.trim().length === 0 && attachments.length === 0) || uploading}
      >{cta}</button>
    </div>
  </div>
</form>

<style>
  .composer {
    padding: var(--space-4);
  }
  textarea {
    background: transparent;
    border: none;
    padding: 0;
    min-height: 70px;
  }
  textarea:focus {
    outline: none;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-top: var(--space-3);
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-3);
  }
  .right {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-left: auto;
  }
  .topic-select {
    font-family: var(--mono);
    font-size: 0.8rem;
    background: var(--color-surface-strong, var(--color-bg-2));
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 3px 6px;
    color: var(--color-text);
    max-width: 160px;
  }
  .count {
    font-size: 0.8rem;
  }
  .thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  .thumb {
    position: relative;
    width: 72px;
    height: 72px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--color-border);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .thumb .remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 20px;
    height: 20px;
    line-height: 18px;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    cursor: pointer;
    font-size: 14px;
  }
  /* The file input is visually hidden; the label's emoji is the affordance. */
  .photo-btn {
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
    user-select: none;
  }
  .photo-btn.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .photo-btn input {
    display: none;
  }
  .upload-error {
    color: var(--color-danger, #e5484d);
    font-size: 0.8rem;
    margin-top: var(--space-2);
  }
</style>
