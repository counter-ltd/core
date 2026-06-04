// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * User-authored themes and the rules that keep them safe.
 *
 * A theme is just a flat map of CSS custom properties that the web app drops
 * into a `:root` style block. Because users write these and we render them, the
 * validation here is the security boundary: it's structural only, the values
 * are never parsed or executed as code.
 */
import { z } from 'zod';

// Keys must be CSS custom properties (`--foo`). The leading `--` is what stops a
// theme from setting arbitrary real CSS properties.
const cssVarKey = z
  .string()
  .regex(/^--[a-z0-9-]+$/i, 'Theme keys must be CSS custom properties like --color-bg');

// Values are bounded plain strings. The refine blocks the characters that could
// close the declaration and inject extra rules or markup (`;{}<>`), which is how
// a malicious value would otherwise break out of the variable it's assigned to.
const cssVarValue = z
  .string()
  .max(200)
  .refine((v) => !/[;{}<>]/.test(v), { message: 'Invalid character in theme value' });

/**
 * The full variable map for a theme. Capped at 200 entries (and required to
 * have at least one) to keep a single theme from ballooning the payload.
 */
export const themeVariablesSchema = z.record(cssVarKey, cssVarValue).refine(
  (obj) => Object.keys(obj).length > 0 && Object.keys(obj).length <= 200,
  { message: 'A theme must have between 1 and 200 variables' },
);
export type ThemeVariables = z.infer<typeof themeVariablesSchema>;

/** Body for creating a theme. Defaults to published so it's shareable right away. */
export const createThemeSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  variables: themeVariablesSchema,
  published: z.boolean().optional().default(true),
});
export type CreateThemeInput = z.infer<typeof createThemeSchema>;

/**
 * Body for choosing what theme a user sees. `themeId: null` clears the active
 * theme back to default; `customVariables` lets them apply one-off overrides
 * without saving a whole named theme.
 */
export const applyThemeSchema = z.object({
  themeId: z.string().uuid().nullable(),
  customVariables: themeVariablesSchema.nullable().optional(),
});
export type ApplyThemeInput = z.infer<typeof applyThemeSchema>;

/** A saved theme as returned by the API. */
export interface Theme {
  id: string;
  name: string;
  description: string | null;
  variables: ThemeVariables;
  published: boolean; // false keeps it private to its author
  author: { id: string; username: string } | null; // null for built-in/system themes
  createdAt: string;
  updatedAt: string;
}
