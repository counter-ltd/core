<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in licensing/LICENSE.md.
-->
<script lang="ts">
  /**
   * Themed checkbox. Replaces the browser default with one that responds to
   * the active theme via CSS custom properties. Supports checked, indeterminate,
   * and disabled states and forwards all standard input attributes (aria-label,
   * name, value, onchange, etc.) to the underlying input element.
   *
   * Bind `checked` for two-way control, or pass it one-way alongside an
   * onchange handler when the checked state is derived externally.
   */
  import type { HTMLInputAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { draw, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  interface Props extends Omit<HTMLInputAttributes, 'checked' | 'type'> {
    checked?: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    /** Extra classes forwarded to the root label element. */
    class?: string;
    children?: Snippet;
  }

  let {
    checked = $bindable(false),
    indeterminate = false,
    disabled = false,
    class: extraClass = '',
    children,
    ...rest
  }: Props = $props();

  let inputEl = $state<HTMLInputElement | null>(null);

  // The indeterminate state is a DOM property, not an HTML attribute,
  // so it can't be set declaratively.
  $effect(() => {
    if (inputEl) inputEl.indeterminate = indeterminate;
  });
</script>

<label class="checkbox {extraClass}" class:disabled>
  <input bind:this={inputEl} bind:checked type="checkbox" {disabled} {...rest} />
  <span class="box" aria-hidden="true">
    {#if indeterminate}
      <span class="dash" in:scale={{ duration: 150, start: 0.4, easing: cubicOut }} out:scale={{ duration: 100, start: 0.4 }}></span>
    {:else if checked}
      <svg viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          in:draw={{ duration: 220, easing: cubicOut }}
          out:draw={{ duration: 120 }}
          d="M1 4L3.5 6.5L9 1"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    {/if}
  </span>
  {#if children}
    <span class="label-text">{@render children()}</span>
  {/if}
</label>

<style>
  .checkbox {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
    user-select: none;
    line-height: 1;
  }

  .checkbox.disabled {
    opacity: 0.4;
    cursor: not-allowed;
    pointer-events: none;
  }

  /* Visually hidden but stays in the accessibility tree and receives focus. */
  input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    margin: 0;
    pointer-events: none;
  }

  .box {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background 100ms ease,
      border-color 100ms ease,
      box-shadow 100ms ease;
    /* Checkmark and dash both read currentColor. */
    color: var(--color-accent-contrast);
  }

  .checkbox:hover .box {
    border-color: var(--color-border-bright);
  }

  input:focus-visible + .box {
    box-shadow: 0 0 0 2px var(--color-accent);
    border-color: var(--color-accent);
  }

  input:checked + .box,
  input:indeterminate + .box {
    background: var(--color-accent);
    border-color: var(--color-accent);
    animation: cb-pop 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }

  @keyframes cb-pop {
    from { transform: scale(0.85); }
    to   { transform: scale(1); }
  }

  svg {
    width: 10px;
    height: 8px;
    display: block;
  }

  .dash {
    width: 8px;
    height: 1.5px;
    background: var(--color-accent-contrast);
    border-radius: 1px;
    display: block;
  }

  .label-text {
    font-size: 0.875rem;
    color: var(--color-text);
  }
</style>
