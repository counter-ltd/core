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

// --- Style tokens: typography, geometry, surface ---

/**
 * Font stacks the editor's font-design control maps onto, keyed by the semantic
 * `--font-design` value (the cross-platform knob iOS also reads). `mono` reuses
 * the base mono stack so it matches the headings face.
 */
export const FONT_STACKS = {
  default: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif',
  mono: "'Berkeley Mono', ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  rounded: '"SF Pro Rounded", ui-rounded, "Hiragino Maru Gothic ProN", system-ui, sans-serif',
} as const;

/**
 * A non-colour editor control. Each owns one canonical `--token` whose value the
 * editor stores as a full CSS string; the visible widget parses the number or
 * choice out of it. Dependent tokens (font stacks, the radius scale) are derived
 * from these by {@link expandThemeVars}, not stored separately.
 */
export type StyleControl =
  | {
      kind: 'select';
      key: string;
      label: string;
      group: StyleGroup;
      default: string;
      options: { value: string; label: string }[];
    }
  | {
      kind: 'range';
      key: string;
      label: string;
      group: StyleGroup;
      default: string;
      min: number;
      max: number;
      step: number;
      unit: string;
    }
  | { kind: 'toggle'; key: string; label: string; group: StyleGroup; default: string; on: string; off: string };

export type StyleGroup = 'type' | 'shape' | 'surface';

/** Soft drop shadow the surface "Shadow" toggle turns on. */
const GLASS_SHADOW = '0 8px 30px rgba(0,0,0,0.45)';

/** The non-colour controls, in display order, grouped for the editor. */
export const THEME_STYLE_CONTROLS: StyleControl[] = [
  {
    kind: 'select',
    key: '--font-design',
    label: 'Font',
    group: 'type',
    default: 'default',
    options: [
      { value: 'default', label: 'System' },
      { value: 'mono', label: 'Monospace' },
      { value: 'serif', label: 'Serif' },
      { value: 'rounded', label: 'Rounded' },
    ],
  },
  { kind: 'range', key: '--letter-spacing', label: 'Letter spacing', group: 'type', default: '0em', min: -0.04, max: 0.16, step: 0.005, unit: 'em' },
  { kind: 'range', key: '--radius', label: 'Corner roundness', group: 'shape', default: '3px', min: 0, max: 24, step: 1, unit: 'px' },
  { kind: 'range', key: '--density', label: 'Density', group: 'shape', default: '1', min: 0.85, max: 1.3, step: 0.05, unit: '' },
  { kind: 'range', key: '--surface-blur', label: 'Surface blur', group: 'surface', default: '0px', min: 0, max: 28, step: 1, unit: 'px' },
  { kind: 'range', key: '--surface-opacity', label: 'Surface opacity', group: 'surface', default: '1', min: 0.2, max: 1, step: 0.02, unit: '' },
  { kind: 'range', key: '--surface-saturate', label: 'Backdrop vividness', group: 'surface', default: '100%', min: 100, max: 220, step: 5, unit: '%' },
  { kind: 'toggle', key: '--surface-shadow', label: 'Drop shadow', group: 'surface', default: 'none', on: GLASS_SHADOW, off: 'none' },
];

/** Every token key the editor manages (colours + style controls). */
export const ALL_THEME_KEYS: string[] = [
  ...THEME_COLOR_TOKENS.map((t) => t.key),
  ...THEME_STYLE_CONTROLS.map((c) => c.key),
];

/** A complete default variable map: colour defaults plus style-control defaults. */
export function defaultThemeVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const t of THEME_COLOR_TOKENS) vars[t.key] = t.default;
  for (const c of THEME_STYLE_CONTROLS) vars[c.key] = c.default;
  return vars;
}

/**
 * Expand the editor's canonical tokens into the full set the CSS consumes.
 *
 * The editor stores one knob per concept (`--font-design`, `--radius`); the base
 * stylesheet needs the resolved tokens (`--font`, `--font-heading`, and the
 * `--radius-sm|-lg` scale). Deriving them here, at apply and submit time, keeps
 * the stored theme self-contained so the web renders correctly while iOS reads
 * the canonical `--font-design` / `--radius` it understands.
 */
export function expandThemeVars(vars: Record<string, string>): Record<string, string> {
  const out = { ...vars };

  const design = (vars['--font-design'] ?? 'default') as keyof typeof FONT_STACKS;
  const stack = FONT_STACKS[design] ?? FONT_STACKS.default;
  out['--font'] = design === 'default' ? FONT_STACKS.default : stack;
  // Headings stay mono on the system default (the machine look); any other
  // design carries through to headings so the whole face changes together.
  out['--font-heading'] = design === 'default' ? FONT_STACKS.mono : stack;

  // Derive the radius scale from the single roundness value so corners stay in
  // proportion (small chips tighter, large cards looser, pills always round).
  const r = parseFloat(vars['--radius'] ?? '3') || 0;
  out['--radius-sm'] = `${Math.max(0, Math.round(r * 0.6))}px`;
  out['--radius-lg'] = `${Math.round(r * 1.6)}px`;
  out['--radius-pill'] = '999px';

  return out;
}

/**
 * Pull just the canonical knobs out of a stored (already-expanded) theme, so an
 * existing theme loads back into the editor controls. Missing keys fall back to
 * the default, which is how an old colours-only theme opens with sane style
 * defaults instead of blanks.
 */
export function canonicalVarsFrom(stored: Record<string, string>): Record<string, string> {
  const base = defaultThemeVars();
  for (const key of ALL_THEME_KEYS) {
    if (stored[key] !== undefined) base[key] = stored[key];
  }
  return base;
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
