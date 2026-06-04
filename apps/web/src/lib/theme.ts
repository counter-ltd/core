// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Client-side theming: push a user's custom colours onto the page and remember
 * their light/dark choice.
 *
 * A theme is nothing but a bag of CSS custom-property overrides. We set them
 * straight on the document root rather than compiling or evaluating anything,
 * which keeps user-supplied theme data from ever becoming user-supplied code.
 */
import type { ThemeVariables } from '@counter/types';

// localStorage keys. Namespaced with "counter:" so we don't collide with
// anything else sharing the origin.
export const THEME_STORAGE_KEY = 'counter:theme';
export const MODE_STORAGE_KEY = 'counter:mode';

/**
 * Apply a theme's variable overrides to the document root, replacing whatever
 * theme was applied before.
 *
 * Pass `null` to strip our overrides and fall back to the stylesheet defaults.
 */
export function applyTheme(variables: ThemeVariables | null): void {
  // No document means we're rendering on the server, where there's nothing to
  // style; bail rather than crash.
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // We stash the keys we set last time in data-applied-vars and remove exactly
  // those, so re-theming clears the previous theme's vars without disturbing
  // any custom properties the base stylesheet owns.
  const prev = root.getAttribute('data-applied-vars');
  if (prev) for (const key of prev.split(',')) root.style.removeProperty(key);

  if (!variables) {
    root.removeAttribute('data-applied-vars');
    return;
  }
  const keys: string[] = [];
  for (const [key, value] of Object.entries(variables)) {
    // Defense in depth: only accept well-formed `--custom-prop` names and
    // values free of CSS-injection characters, so a malicious theme can't
    // smuggle extra declarations or close the rule early.
    if (/^--[a-z0-9-]+$/i.test(key) && !/[;{}<>]/.test(value)) {
      root.style.setProperty(key, value);
      keys.push(key);
    }
  }
  root.setAttribute('data-applied-vars', keys.join(','));
}

/**
 * Switch the page between light and dark mode and persist the choice.
 *
 * The `data-theme` attribute is what the CSS keys off; localStorage is so the
 * preference survives a reload (the app re-reads it on boot).
 */
export function setMode(mode: 'dark' | 'light'): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', mode);
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage throws in private-mode/locked-down browsers. The mode is
    // already applied above, so losing only the persistence is fine.
  }
}
