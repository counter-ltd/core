<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Themed multi-select dropdown. Works like Select but allows any number of
   * options to be checked simultaneously. Each selected value is submitted as a
   * separate hidden input, matching the behaviour of a native multi-select.
   *
   * The trigger summarises the selection: nothing → placeholder, one item →
   * its label, two items → both labels, three or more → "N selected".
   */

  import Checkbox from '$lib/components/Checkbox.svelte';

  /** Shape expected by the options prop. */
  export interface MultiSelectOption {
    value: string;
    label: string;
    disabled?: boolean;
  }

  interface Props {
    /** Currently selected values. Bind for two-way control. */
    value?: string[];
    /** All available options. */
    options: MultiSelectOption[];
    /** Form field name — renders one hidden input per selected value. */
    name?: string;
    /** Applied to the trigger button for label[for] association. */
    id?: string;
    /** Text shown when nothing is selected. */
    placeholder?: string;
    disabled?: boolean;
    /** Extra classes on the root element. */
    class?: string;
    'aria-label'?: string;
    /** Called with the updated values array whenever the selection changes. */
    onchange?: (values: string[]) => void;
  }

  let {
    value = $bindable<string[]>([]),
    options,
    name,
    id,
    placeholder = 'Select…',
    disabled = false,
    class: extraClass = '',
    'aria-label': ariaLabel,
    onchange,
  }: Props = $props();

  let open = $state(false);
  let containerEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);

  const selectedOptions = $derived(options.filter((o) => value.includes(o.value)));

  const triggerText = $derived(
    selectedOptions.length === 0
      ? placeholder
      : selectedOptions.length <= 2
        ? selectedOptions.map((o) => o.label).join(', ')
        : `${selectedOptions.length} selected`,
  );

  const allSelected = $derived(
    options.filter((o) => !o.disabled).every((o) => value.includes(o.value)),
  );
  const someSelected = $derived(selectedOptions.length > 0 && !allSelected);

  function toggle() {
    if (disabled) return;
    open = !open;
  }

  function toggleOption(optValue: string) {
    const next = value.includes(optValue)
      ? value.filter((v) => v !== optValue)
      : [...value, optValue];
    value = next;
    onchange?.(next);
  }

  function toggleAll() {
    const enabledValues = options.filter((o) => !o.disabled).map((o) => o.value);
    const next = allSelected ? value.filter((v) => !enabledValues.includes(v)) : [...new Set([...value, ...enabledValues])];
    value = next;
    onchange?.(next);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      open = false;
      triggerEl?.focus();
    } else if (e.key === 'Tab') {
      open = false;
    }
  }

  $effect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (!containerEl?.contains(e.target as Node)) open = false;
    }
    document.addEventListener('mousedown', handleOutside, true);
    return () => document.removeEventListener('mousedown', handleOutside, true);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={containerEl}
  class="multiselect {extraClass}"
  class:open
  class:disabled
  onkeydown={handleKeydown}
>
  {#if name}
    {#each value as v}
      <input type="hidden" {name} value={v} />
    {/each}
  {/if}

  <button
    bind:this={triggerEl}
    {id}
    type="button"
    class="trigger"
    class:placeholder={selectedOptions.length === 0}
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={ariaLabel}
    onclick={toggle}
  >
    <span class="trigger-label">{triggerText}</span>
    <span class="chevron" aria-hidden="true">
      <svg viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M1 1L5 5L9 1"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
  </button>

  {#if open}
    <div class="panel" role="listbox" aria-multiselectable="true" aria-label={ariaLabel}>
      {#if options.length > 1}
        <div class="option select-all">
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected}
            onchange={toggleAll}
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </Checkbox>
        </div>
        <div class="divider" role="separator"></div>
      {/if}
      {#each options as opt (opt.value)}
        <div
          class="option"
          class:disabled={opt.disabled}
          role="option"
          aria-selected={value.includes(opt.value)}
        >
          <Checkbox
            checked={value.includes(opt.value)}
            disabled={opt.disabled}
            onchange={() => toggleOption(opt.value)}
          >
            {opt.label}
          </Checkbox>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .multiselect {
    position: relative;
    width: 100%;
  }

  .trigger {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-family: var(--mono);
    font-size: 0.9rem;
    color: var(--color-text);
    background: var(--color-bg-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    cursor: pointer;
    text-align: left;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease;
    min-width: 0;
  }

  .trigger.placeholder {
    color: var(--color-text-faint);
  }

  .trigger:hover:not(:disabled) {
    border-color: var(--color-border-bright);
  }

  .trigger:focus-visible {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 30%, transparent);
  }

  .open .trigger {
    border-color: var(--color-accent);
    border-bottom-color: transparent;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .disabled .trigger {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .trigger-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron {
    flex-shrink: 0;
    color: var(--color-text-faint);
    display: flex;
    align-items: center;
    transition: transform 150ms ease;
  }

  .open .chevron {
    transform: rotate(180deg);
  }

  .chevron svg {
    width: 10px;
    height: 6px;
    display: block;
  }

  .panel {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 50;
    background: var(--color-bg-2);
    border: 1px solid var(--color-accent);
    border-top: none;
    border-bottom-left-radius: var(--radius-sm);
    border-bottom-right-radius: var(--radius-sm);
    overflow-y: auto;
    max-height: 280px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .option {
    padding: var(--space-2) var(--space-3);
  }

  .option.disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  .option:hover {
    background: var(--color-surface-strong);
  }

  .select-all {
    background: color-mix(in srgb, var(--color-accent) 5%, transparent);
  }

  .divider {
    height: 1px;
    background: var(--color-border);
    margin: 0;
  }
</style>
