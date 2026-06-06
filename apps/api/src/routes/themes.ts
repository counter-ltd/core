// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * User-created visual themes: browsing the published gallery, viewing one, and
 * creating or deleting your own.
 *
 * A theme is essentially a bag of CSS variables plus some metadata. Browsing is
 * public and limited to published themes; creating and deleting require auth and
 * only ever touch the caller's own rows.
 */
import { Hono } from 'hono';
import { db, themes, savedThemes, users, eq, and, desc } from '@counter/db';
import {
  createThemeSchema,
  paginationQuerySchema,
  themeVariablesSchema,
  updateThemeSchema,
} from '@counter/types';
import type { Page, Theme, ThemeLibrary, ThemeVariables } from '@counter/types';
import { body, query } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { keysetWhere, paginate } from '../lib/cursor.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import type { AppEnv } from '../types.ts';

export const themeRoutes = new Hono<AppEnv>();

type ThemeRow = typeof themes.$inferSelect;

/**
 * Shape a raw theme row into the public Theme response.
 *
 * @param author  The theme's creator as a slim {id, username}, or null when the
 *                author can't be resolved, so a deleted account doesn't 500 the
 *                whole response.
 */
function toTheme(row: ThemeRow, author: { id: string; username: string } | null): Theme {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    variables: row.variables as ThemeVariables,
    published: row.published,
    author,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --- browse (public) ---

// The published-themes gallery, newest-first and keyset-paginated. Joins the
// author in so each card can credit its creator without a follow-up query.
themeRoutes.get('/', async (c) => {
  const { after, limit } = query(c, paginationQuerySchema);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.themes.findFirst({ where: eq(themes.id, after) });
    if (row) cursor = { createdAt: row.createdAt, id: row.id };
  }

  // Browse only surfaces published themes; drafts stay private to their author.
  const base = eq(themes.published, true);
  const where = keysetWhere(themes.createdAt, themes.id, cursor, base);
  const rows = await db
    .select({ theme: themes, authorId: users.id, authorUsername: users.username })
    .from(themes)
    .innerJoin(users, eq(users.id, themes.userId))
    .where(where)
    .orderBy(desc(themes.createdAt), desc(themes.id))
    .limit(limit + 1);

  const { data: pageRows, nextCursor } = paginate(rows, limit, (r) => r.theme.id);
  const data = pageRows.map((r) =>
    toTheme(r.theme, { id: r.authorId, username: r.authorUsername }),
  );
  return c.json<Page<Theme>>({ data, nextCursor });
});

// The caller's Library: themes they authored, plus themes they saved from other
// people's galleries. Registered before `/:id` on purpose, otherwise the param
// route would match "library" as an id and 404.
themeRoutes.get('/library', requireAuth, async (c) => {
  const userId = requireUserId(c);

  // Own themes, drafts and all, newest first. The author is the caller, so no
  // join is needed to credit them.
  const createdRows = await db
    .select()
    .from(themes)
    .where(eq(themes.userId, userId))
    .orderBy(desc(themes.createdAt), desc(themes.id));
  const me = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const author = me ? { id: me.id, username: me.username } : null;
  const created = createdRows.map((row) => toTheme(row, author));

  // Saved themes, ordered by when they were saved (not when they were authored),
  // so the most recently kept theme sits at the top of the list. Joins the real
  // author in so saved cards still credit whoever made the theme.
  const savedRows = await db
    .select({ theme: themes, authorId: users.id, authorUsername: users.username })
    .from(savedThemes)
    .innerJoin(themes, eq(themes.id, savedThemes.themeId))
    .innerJoin(users, eq(users.id, themes.userId))
    .where(eq(savedThemes.userId, userId))
    .orderBy(desc(savedThemes.createdAt));
  const saved = savedRows.map((r) =>
    toTheme(r.theme, { id: r.authorId, username: r.authorUsername }),
  );

  return c.json<ThemeLibrary>({ created, saved });
});

// Fetch one theme by id, author joined in. No published filter here, so a theme
// is reachable by direct id even while unpublished (handy for previewing your
// own draft via a shared link).
themeRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await db
    .select({ theme: themes, authorId: users.id, authorUsername: users.username })
    .from(themes)
    .innerJoin(users, eq(users.id, themes.userId))
    .where(eq(themes.id, id))
    .limit(1);
  const found = row[0];
  if (!found) throw errors.notFound('Theme not found');
  return c.json(toTheme(found.theme, { id: found.authorId, username: found.authorUsername }));
});

// --- create / delete ---

// Create a theme owned by the caller.
themeRoutes.post('/', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, createThemeSchema);
  // Re-validate the variable map on its own, even though the body schema already
  // ran. The variables are user-authored CSS that gets injected into pages, so
  // we check their shape a second time here rather than trust the outer parse.
  const variables = themeVariablesSchema.parse(input.variables);

  const [created] = await db
    .insert(themes)
    .values({
      userId,
      name: input.name,
      description: input.description ?? null,
      variables,
      published: input.published,
    })
    .returning();
  if (!created) throw errors.internal('Failed to create theme');

  const author = await db.query.users.findFirst({ where: eq(users.id, userId) });
  return c.json(
    toTheme(created, author ? { id: author.id, username: author.username } : null),
    201,
  );
});

// Edit one of your own themes. Same ownership rules as delete: 404 if it
// doesn't exist, 403 if it isn't yours. Every field is optional, so this is a
// partial update, only the keys the caller sends change.
themeRoutes.patch('/:id', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const input = await body(c, updateThemeSchema);

  const row = await db.query.themes.findFirst({ where: eq(themes.id, id) });
  if (!row) throw errors.notFound('Theme not found');
  if (row.userId !== userId) throw errors.forbidden('You can only edit your own themes');

  // Build the patch from only the fields that were actually provided, so an
  // omitted key keeps its current value rather than getting nulled out.
  const patch: Partial<typeof themes.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.published !== undefined) patch.published = input.published;
  // Same belt-and-braces re-validation as create: the variables are injected
  // into pages as CSS, so re-check their shape before persisting.
  if (input.variables !== undefined) patch.variables = themeVariablesSchema.parse(input.variables);

  const [updated] = await db
    .update(themes)
    .set(patch)
    // Re-assert ownership in the WHERE too, so the update can never touch
    // another user's row even if the guard above were bypassed.
    .where(and(eq(themes.id, id), eq(themes.userId, userId)))
    .returning();
  if (!updated) throw errors.internal('Failed to update theme');

  const author = await db.query.users.findFirst({ where: eq(users.id, userId) });
  return c.json(toTheme(updated, author ? { id: author.id, username: author.username } : null));
});

// Delete one of your own themes. A theme that belongs to someone else gets a
// 403, distinct from the 404 for one that doesn't exist, so the owner sees a
// clear "not yours" rather than a misleading "not found".
themeRoutes.delete('/:id', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const row = await db.query.themes.findFirst({ where: eq(themes.id, id) });
  if (!row) throw errors.notFound('Theme not found');
  if (row.userId !== userId) throw errors.forbidden('You can only delete your own themes');

  // Re-assert userId in the WHERE as well as the check above, so the delete can
  // never hit another user's row even if the guard were ever bypassed.
  await db.delete(themes).where(and(eq(themes.id, id), eq(themes.userId, userId)));
  return c.json({ ok: true });
});

// --- save / unsave (Library membership) ---

// Save a theme into the caller's Library. The theme has to exist first (404
// otherwise) so we never leave a dangling saved row pointing at nothing. The
// insert is idempotent: saving the same theme twice is a no-op, not an error,
// so a double-tap on Save doesn't blow up on the (userId, themeId) primary key.
themeRoutes.post('/:id/save', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const theme = await db.query.themes.findFirst({ where: eq(themes.id, id) });
  if (!theme) throw errors.notFound('Theme not found');

  await db.insert(savedThemes).values({ userId, themeId: id }).onConflictDoNothing();
  return c.json({ ok: true });
});

// Remove a theme from the caller's Library. Scoped to the caller's own saved
// row, so unsaving only ever touches your membership, never the theme itself or
// anyone else's. Unsaving something you never saved is a harmless no-op.
themeRoutes.delete('/:id/save', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  await db
    .delete(savedThemes)
    .where(and(eq(savedThemes.userId, userId), eq(savedThemes.themeId, id)));
  return c.json({ ok: true });
});
