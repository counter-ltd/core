import { z } from 'zod';

/**
 * Themes are flat JSON maps of CSS custom properties. Validated for structure
 * on write, NEVER executed. Keys must look like `--token-name`, values are
 * plain strings (colors, lengths, shadows). No nesting, no functions.
 */
const cssVarKey = z
  .string()
  .regex(/^--[a-z0-9-]+$/i, 'Theme keys must be CSS custom properties like --color-bg');

const cssVarValue = z
  .string()
  .max(200)
  // Disallow characters that could break out of a declaration context.
  .refine((v) => !/[;{}<>]/.test(v), { message: 'Invalid character in theme value' });

export const themeVariablesSchema = z.record(cssVarKey, cssVarValue).refine(
  (obj) => Object.keys(obj).length > 0 && Object.keys(obj).length <= 200,
  { message: 'A theme must have between 1 and 200 variables' },
);
export type ThemeVariables = z.infer<typeof themeVariablesSchema>;

export const createThemeSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  variables: themeVariablesSchema,
  published: z.boolean().optional().default(true),
});
export type CreateThemeInput = z.infer<typeof createThemeSchema>;

export const applyThemeSchema = z.object({
  themeId: z.string().uuid().nullable(),
  customVariables: themeVariablesSchema.nullable().optional(),
});
export type ApplyThemeInput = z.infer<typeof applyThemeSchema>;

export interface Theme {
  id: string;
  name: string;
  description: string | null;
  variables: ThemeVariables;
  published: boolean;
  author: { id: string; username: string } | null;
  createdAt: string;
  updatedAt: string;
}
