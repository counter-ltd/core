<script lang="ts">
  import { POST } from '@counter/config';

  let {
    parentId = null,
    redirectTo = '/feed',
    placeholder = "What's happening?",
    cta = 'Post',
  }: { parentId?: string | null; redirectTo?: string; placeholder?: string; cta?: string } =
    $props();

  let value = $state('');
</script>

<form method="POST" action="/actions/compose" class="composer panel">
  {#if parentId}<input type="hidden" name="parentId" value={parentId} />{/if}
  <input type="hidden" name="redirectTo" value={redirectTo} />
  <textarea
    name="body"
    {placeholder}
    maxlength={POST.MAX_BODY_LENGTH}
    bind:value
    required
  ></textarea>
  <div class="bar">
    <span class="faint count">{value.length}/{POST.MAX_BODY_LENGTH}</span>
    <button class="btn btn-primary" type="submit" disabled={value.trim().length === 0}>{cta}</button>
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
    margin-top: var(--space-3);
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-3);
  }
  .count {
    font-size: 0.8rem;
  }
</style>
