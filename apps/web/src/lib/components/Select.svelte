<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * Themed single-select dropdown. Fully custom so the options panel inherits
   * the active theme's colours and radius — no browser-native dropdown. Passes
   * the selected value to a hidden input for standard form submission.
   *
   * Callers can bind:value for two-way control or pass value one-way with an
   * onchange handler. If no option matches the initial value the trigger shows
   * the placeholder text; callers should pass a sensible initial value when
   * there is no blank option.
   */

  /** Shape expected by the options prop. */
  export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
  }

  interface Props {
    /** Currently selected value. Bind for two-way control. */
    value?: string;
    /** All available options. */
    options: SelectOption[];
    /** Form field name — renders a hidden input for submission. */
    name?: string;
    /** Applied to the trigger button for label[for] association. */
    id?: string;
    /** Text shown when no option is selected. */
    placeholder?: string;
    disabled?: boolean;
    /** Extra classes on the root element. */
    class?: string;
    'aria-label'?: string;
    /** Called with the new value whenever the selection changes. */
    onchange?: (value: string) => void;
  }

  let {
    value = $bindable(''),
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
  // -1 means no option is keyboard-focused; drives the .focused highlight.
  let focusedIndex = $state(-1);
  let containerEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);

  const selectedOption = $derived(options.find((o) => o.value === value));
  const selectedLabel = $derived(selectedOption?.label ?? placeholder);
  const hasValue = $derived(selectedOption !== undefined);

  function openPanel() {
    if (disabled) return;
    open = true;
    // Start keyboard focus on the currently selected option, or first.
    focusedIndex = Math.max(
      options.findIndex((o) => o.value === value),
      0,
    );
  }

  function closePanel() {
    open = false;
    focusedIndex = -1;
  }

  function pick(optValue: string) {
    value = optValue;
    closePanel();
    triggerEl?.focus();
    onchange?.(optValue);
  }

  function handleTriggerKeydown(e: KeyboardEvent) {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        openPanel();
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      closePanel();
      triggerEl?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusedIndex = Math.min(focusedIndex + 1, options.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusedIndex = Math.max(focusedIndex - 1, 0);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const opt = options[focusedIndex];
      if (opt && !opt.disabled) pick(opt.value);
    } else if (e.key === 'Tab') {
      closePanel();
    }
  }

  // Close on any click outside the component while the panel is open.
  $effect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (!containerEl?.contains(e.target as Node)) closePanel();
    }
    document.addEventListener('mousedown', handleOutside, true);
    return () => document.removeEventListener('mousedown', handleOutside, true);
  });
</script>

<div bind:this={containerEl} class="select {extraClass}" class:open class:disabled>
  {#if name}
    <input type="hidden" {name} value={value} />
  {/if}

  <button
    bind:this={triggerEl}
    {id}
    type="button"
    class="trigger"
    class:placeholder={!hasValue}
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={ariaLabel}
    onclick={() => (open ? closePanel() : openPanel())}
    onkeydown={handleTriggerKeydown}
  >
    <span class="trigger-label">{selectedLabel}</span>
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
    <div class="panel" role="listbox" aria-label={ariaLabel}>
      {#each options as opt, i (opt.value)}
        <div
          class="option"
          class:selected={opt.value === value}
          class:focused={focusedIndex === i}
          class:disabled={opt.disabled}
          role="option"
          aria-selected={opt.value === value}
          aria-disabled={opt.disabled}
          tabindex="-1"
          onmousedown={(e) => {
            // Prevent blur on the trigger (which would close the panel before
            // the selection registers).
            e.preventDefault();
            if (!opt.disabled) pick(opt.value);
          }}
          onmouseenter={() => (focusedIndex = i)}
        >
          {opt.label}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .select {
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

  /* Merge the trigger's bottom border with the panel's top border when open. */
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
    max-height: 240px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .option {
    padding: var(--space-2) var(--space-3);
    font-family: var(--mono);
    font-size: 0.9rem;
    color: var(--color-text);
    cursor: pointer;
  }

  .option.selected {
    color: var(--color-accent);
  }

  .option.focused,
  .option:hover {
    background: var(--color-surface-strong);
  }

  .option.disabled {
    color: var(--color-text-faint);
    cursor: not-allowed;
  }
</style>
