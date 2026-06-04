import type { ThemeVariables } from '@counter/types';

export const THEME_STORAGE_KEY = 'counter:theme';
export const MODE_STORAGE_KEY = 'counter:mode';

/**
 * Apply a flat map of CSS custom properties to the document root. Theming is
 * just variable overrides — no recompilation, no execution of theme data.
 */
export function applyTheme(variables: ThemeVariables | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // Clear any previously applied overrides we own.
  const prev = root.getAttribute('data-applied-vars');
  if (prev) for (const key of prev.split(',')) root.style.removeProperty(key);

  if (!variables) {
    root.removeAttribute('data-applied-vars');
    return;
  }
  const keys: string[] = [];
  for (const [key, value] of Object.entries(variables)) {
    if (/^--[a-z0-9-]+$/i.test(key) && !/[;{}<>]/.test(value)) {
      root.style.setProperty(key, value);
      keys.push(key);
    }
  }
  root.setAttribute('data-applied-vars', keys.join(','));
}

export function setMode(mode: 'dark' | 'light'): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', mode);
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* storage may be unavailable */
  }
}
