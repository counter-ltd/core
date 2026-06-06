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
 * The colour tokens the Create editor lets a user set, in display order.
 *
 * One entry per editable `--color-*` custom property: the variable it drives, a
 * human label for the form field, and the dark-theme default (lifted straight
 * from `:root` in app.css) so a fresh theme opens on the current look rather
 * than black. This is the single source of truth for both the editor inputs and
 * the server action that maps the submitted colours back onto their variables.
 */
export const THEME_COLOR_TOKENS = [
  { key: '--color-bg', label: 'Background', default: '#0c0c0d' },
  { key: '--color-bg-2', label: 'Background 2', default: '#161619' },
  { key: '--color-surface', label: 'Surface', default: '#121214' },
  { key: '--color-surface-strong', label: 'Surface strong', default: '#1c1c21' },
  { key: '--color-border', label: 'Border', default: '#2b2b31' },
  { key: '--color-border-bright', label: 'Border bright', default: '#45454d' },
  { key: '--color-text', label: 'Text', default: '#e8e8ea' },
  { key: '--color-text-dim', label: 'Text dim', default: '#97979e' },
  { key: '--color-text-faint', label: 'Text faint', default: '#64646b' },
  { key: '--color-accent', label: 'Accent', default: '#e0a23c' },
  { key: '--color-accent-2', label: 'Accent 2', default: '#6fae8f' },
  { key: '--color-accent-contrast', label: 'Accent contrast', default: '#0c0c0d' },
  { key: '--color-like', label: 'Like', default: '#e5577d' },
  { key: '--color-repost', label: 'Repost', default: '#4fb98a' },
  { key: '--color-danger', label: 'Danger', default: '#e5484d' },
] as const;

/**
 * Build an inline `style` string of CSS variable declarations from a colour map.
 *
 * The Create preview sets these on a wrapper element rather than the document
 * root, so the example post recolours live while the rest of the page (and the
 * editor chrome itself) stays on the real theme. Same structural guard as
 * {@link applyTheme}: skip any key or value that could break out of the
 * declaration, so a half-typed colour can never inject extra CSS.
 */
export function previewVars(map: Record<string, string>): string {
  return Object.entries(map)
    .filter(([key, value]) => /^--[a-z0-9-]+$/i.test(key) && !/[;{}<>]/.test(value))
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

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
