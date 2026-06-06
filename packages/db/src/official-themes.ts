// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The official theme catalog Counter ships.
 *
 * Shared between the dev seed (which wipes and reinserts) and `seed-official.ts`
 * (the idempotent, production-safe populate). Defining the catalog once here
 * keeps the two in sync. `official: true` is only ever set on these rows, never
 * by any API, so the badge can't be spoofed.
 *
 * Each theme is the default token map plus a handful of overrides; `expand()`
 * derives the font stacks and the radius scale exactly as the web and iOS
 * editors do on save, so a stored theme renders correctly on the web while iOS
 * reads the canonical knobs (`--font-design`, `--radius`).
 */

const sans = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif';
const monoStack = "'Berkeley Mono', ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";
const serifStack = 'ui-serif, Georgia, Cambria, "Times New Roman", serif';
const roundedStack = '"SF Pro Rounded", ui-rounded, "Hiragino Maru Gothic ProN", system-ui, sans-serif';

const baseVars: Record<string, string> = {
  '--color-bg': '#0c0c0d', '--color-bg-2': '#161619', '--color-surface': '#121214',
  '--color-surface-strong': '#1c1c21', '--color-border': '#2b2b31', '--color-border-bright': '#45454d',
  '--color-text': '#e8e8ea', '--color-text-dim': '#97979e', '--color-text-faint': '#64646b',
  '--color-accent': '#e0a23c', '--color-accent-2': '#6fae8f', '--color-accent-contrast': '#0c0c0d',
  '--color-like': '#e5577d', '--color-repost': '#4fb98a', '--color-danger': '#e5484d',
  '--font-design': 'default', '--letter-spacing': '0em', '--radius': '3px', '--density': '1',
  '--surface-blur': '0px', '--surface-opacity': '1', '--surface-saturate': '100%', '--surface-shadow': 'none',
};

/** Derive the font stacks + radius scale from the canonical knobs. */
function expand(vars: Record<string, string>): Record<string, string> {
  const out = { ...vars };
  const d = out['--font-design'] ?? 'default';
  const stack = d === 'mono' ? monoStack : d === 'serif' ? serifStack : d === 'rounded' ? roundedStack : sans;
  out['--font'] = d === 'default' ? sans : stack;
  out['--font-heading'] = d === 'default' ? monoStack : stack;
  const r = parseFloat(out['--radius'] ?? '3') || 0;
  out['--radius-sm'] = `${Math.max(0, Math.round(r * 0.6))}px`;
  out['--radius-lg'] = `${Math.round(r * 1.6)}px`;
  out['--radius-pill'] = '999px';
  return out;
}

/** The specular highlight + chromatic-fringe rim that makes the glass refract. */
const glassShadow =
  '0 10px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.28), inset 1px 0 0 rgba(130,180,255,0.18), inset -1px 0 0 rgba(255,150,220,0.16)';

/** One catalog entry: just name, description, and the overrides off baseVars. */
interface CatalogEntry {
  name: string;
  description: string;
  overrides: Record<string, string>;
}

/** The catalog itself, platform-agnostic (it's only token data). */
const CATALOG: CatalogEntry[] = [
  // Core looks.
  { name: 'Counter Dark', description: 'The Counter default. Amber on near-black.', overrides: {} },
  {
    name: 'Counter Light', description: 'Paper-bright light mode.', overrides: {
      '--color-bg': '#f7f6f3', '--color-bg-2': '#efece6', '--color-surface': '#ffffff',
      '--color-surface-strong': '#f1efe9', '--color-border': '#dcd8cf', '--color-border-bright': '#b6b1a4',
      '--color-text': '#17160f', '--color-text-dim': '#57544a', '--color-text-faint': '#8a8678',
      '--color-accent': '#aa6300', '--color-accent-contrast': '#fffaf0', '--color-like': '#c1325a', '--color-repost': '#2f8f68',
    },
  },
  {
    name: 'Rounded', description: 'Soft corners and cool blues. Just the shape.', overrides: {
      '--color-bg': '#0a0c12', '--color-bg-2': '#11131c', '--color-surface': '#1a1e2b',
      '--color-surface-strong': '#252a3b', '--color-border': '#3a4055', '--color-border-bright': '#5b627d',
      '--color-accent': '#7cc4ff', '--color-accent-2': '#b69dff', '--color-accent-contrast': '#06080f',
      '--font-design': 'rounded', '--radius': '14px', '--density': '1.1',
    },
  },
  {
    name: 'Liquid Glass', description: 'Frosted, refractive glass. The real thing.', overrides: {
      '--color-bg': '#060810', '--color-bg-2': '#0c1020', '--color-surface': '#4a5578',
      '--color-surface-strong': '#5a6794', '--color-border': '#7d8bc0', '--color-border-bright': '#9aa6d8',
      '--color-text': '#eef1ff', '--color-text-dim': '#c2c9ec', '--color-text-faint': '#8b93bf',
      '--color-accent': '#8fd0ff', '--color-accent-2': '#c4a8ff', '--color-accent-contrast': '#060810',
      '--font-design': 'rounded', '--radius': '18px', '--density': '1.12',
      '--surface-opacity': '0.32', '--surface-blur': '20px', '--surface-saturate': '180%', '--surface-shadow': glassShadow,
    },
  },
  {
    name: 'Terminal', description: 'Phosphor green, monospace, sharp.', overrides: {
      '--color-bg': '#020402', '--color-bg-2': '#050a05', '--color-surface': '#0a0f0a',
      '--color-surface-strong': '#0f180f', '--color-border': '#1f3a1f', '--color-border-bright': '#2f7a3d',
      '--color-text': '#9bff9b', '--color-text-dim': '#5fbf5f', '--color-text-faint': '#3a7a3a',
      '--color-accent': '#3dff7a', '--color-accent-2': '#1f7a3d', '--color-accent-contrast': '#020402',
      '--color-like': '#ff5f87', '--color-repost': '#3dff7a', '--font-design': 'mono', '--letter-spacing': '0.01em', '--radius': '0px',
    },
  },
  // Popular developer palettes.
  {
    name: 'Nord', description: 'The cool, frosty Nord palette.', overrides: {
      '--color-bg': '#2e3440', '--color-bg-2': '#3b4252', '--color-surface': '#3b4252',
      '--color-surface-strong': '#434c5e', '--color-border': '#4c566a', '--color-border-bright': '#616e88',
      '--color-text': '#eceff4', '--color-text-dim': '#d8dee9', '--color-text-faint': '#9aa5b8',
      '--color-accent': '#88c0d0', '--color-accent-2': '#a3be8c', '--color-accent-contrast': '#2e3440',
      '--color-like': '#bf616a', '--color-repost': '#a3be8c', '--color-danger': '#bf616a', '--radius': '6px',
    },
  },
  {
    name: 'Dracula', description: 'Purple-and-pink dark, the classic.', overrides: {
      '--color-bg': '#282a36', '--color-bg-2': '#21222c', '--color-surface': '#343746',
      '--color-surface-strong': '#424458', '--color-border': '#44475a', '--color-border-bright': '#6272a4',
      '--color-text': '#f8f8f2', '--color-text-dim': '#bbbdd0', '--color-text-faint': '#6272a4',
      '--color-accent': '#bd93f9', '--color-accent-2': '#50fa7b', '--color-accent-contrast': '#282a36',
      '--color-like': '#ff79c6', '--color-repost': '#50fa7b', '--color-danger': '#ff5555', '--radius': '6px',
    },
  },
  {
    name: 'Solarized Dark', description: "Schoonover's precision dark.", overrides: {
      '--color-bg': '#002b36', '--color-bg-2': '#073642', '--color-surface': '#073642',
      '--color-surface-strong': '#0a4250', '--color-border': '#114b54', '--color-border-bright': '#586e75',
      '--color-text': '#93a1a1', '--color-text-dim': '#839496', '--color-text-faint': '#657b83',
      '--color-accent': '#b58900', '--color-accent-2': '#2aa198', '--color-accent-contrast': '#002b36',
      '--color-like': '#dc322f', '--color-repost': '#859900', '--color-danger': '#dc322f', '--radius': '4px',
    },
  },
  {
    name: 'Gruvbox', description: 'Warm retro, easy on the eyes.', overrides: {
      '--color-bg': '#282828', '--color-bg-2': '#1d2021', '--color-surface': '#32302f',
      '--color-surface-strong': '#3c3836', '--color-border': '#504945', '--color-border-bright': '#665c54',
      '--color-text': '#ebdbb2', '--color-text-dim': '#d5c4a1', '--color-text-faint': '#a89984',
      '--color-accent': '#fabd2f', '--color-accent-2': '#b8bb26', '--color-accent-contrast': '#282828',
      '--color-like': '#fb4934', '--color-repost': '#b8bb26', '--color-danger': '#fb4934', '--radius': '4px',
    },
  },
  // Vibey extras.
  {
    name: 'Synthwave', description: 'Neon magenta and cyan. 1984 forever.', overrides: {
      '--color-bg': '#1a1033', '--color-bg-2': '#241548', '--color-surface': '#2a1a4a',
      '--color-surface-strong': '#3a2563', '--color-border': '#4a2f7a', '--color-border-bright': '#7d52c4',
      '--color-text': '#ffe5ff', '--color-text-dim': '#d59bff', '--color-text-faint': '#8b6fb5',
      '--color-accent': '#ff2fb9', '--color-accent-2': '#2de2e6', '--color-accent-contrast': '#1a1033',
      '--color-like': '#ff2fb9', '--color-repost': '#2de2e6', '--color-danger': '#ff5555', '--font-design': 'mono', '--radius': '2px',
    },
  },
  {
    name: 'Sepia', description: 'Old-paper warmth, serif type.', overrides: {
      '--color-bg': '#f4ecd8', '--color-bg-2': '#ece0c4', '--color-surface': '#fbf5e6',
      '--color-surface-strong': '#efe5cc', '--color-border': '#d8c9a6', '--color-border-bright': '#b8a47a',
      '--color-text': '#3b2f1c', '--color-text-dim': '#6b5a3c', '--color-text-faint': '#9a8862',
      '--color-accent': '#9a6a2f', '--color-accent-2': '#6a7a3c', '--color-accent-contrast': '#fbf5e6',
      '--color-like': '#b3402f', '--color-repost': '#6a7a3c', '--color-danger': '#b3402f', '--font-design': 'serif', '--radius': '6px',
    },
  },
  {
    name: 'Anthropic Light', description: "Claude's warm cream and clay, in serif.", overrides: {
      '--color-bg': '#faf9f5', '--color-bg-2': '#f0eee6', '--color-surface': '#ffffff',
      '--color-surface-strong': '#f0eee6', '--color-border': '#e3e1d6', '--color-border-bright': '#cfccbd',
      '--color-text': '#1f1e1d', '--color-text-dim': '#5c5a54', '--color-text-faint': '#8c897e',
      '--color-accent': '#d97757', '--color-accent-2': '#b05730', '--color-accent-contrast': '#ffffff',
      '--color-like': '#cc3f4e', '--color-repost': '#6a9a7b', '--color-danger': '#bc4040',
      '--font-design': 'serif', '--radius': '10px',
    },
  },
  {
    name: 'Anthropic Dark', description: 'Claude clay on warm charcoal, in serif.', overrides: {
      '--color-bg': '#1a1915', '--color-bg-2': '#21201b', '--color-surface': '#262420',
      '--color-surface-strong': '#33302a', '--color-border': '#3a372f', '--color-border-bright': '#565247',
      '--color-text': '#f5f3ee', '--color-text-dim': '#b8b4a8', '--color-text-faint': '#807c70',
      '--color-accent': '#d97757', '--color-accent-2': '#e0996f', '--color-accent-contrast': '#1a1915',
      '--color-like': '#e5577d', '--color-repost': '#6a9a7b', '--color-danger': '#e5675f',
      '--font-design': 'serif', '--radius': '10px',
    },
  },
  {
    name: 'Mono Light', description: 'Black ink on white, monospace.', overrides: {
      '--color-bg': '#ffffff', '--color-bg-2': '#f4f4f5', '--color-surface': '#ffffff',
      '--color-surface-strong': '#ececef', '--color-border': '#e0e0e3', '--color-border-bright': '#c4c4c8',
      '--color-text': '#18181b', '--color-text-dim': '#52525b', '--color-text-faint': '#a1a1aa',
      '--color-accent': '#18181b', '--color-accent-2': '#52525b', '--color-accent-contrast': '#ffffff',
      '--color-like': '#18181b', '--color-repost': '#52525b', '--color-danger': '#dc2626', '--font-design': 'mono', '--radius': '4px',
    },
  },
];

/** A theme insert row, ready to hand to `db.insert(themes)`. */
export interface OfficialThemeRow {
  userId: string;
  name: string;
  description: string;
  variables: Record<string, string>;
  published: boolean;
  official: boolean;
}

/** Build the catalog as theme insert rows owned by `authorId`. */
export function officialThemeRows(authorId: string): OfficialThemeRow[] {
  return CATALOG.map((entry) => ({
    userId: authorId,
    name: entry.name,
    description: entry.description,
    variables: expand({ ...baseVars, ...entry.overrides }),
    published: true,
    official: true,
  }));
}

/** Just the names, for idempotency checks. */
export const officialThemeNames: string[] = CATALOG.map((e) => e.name);
