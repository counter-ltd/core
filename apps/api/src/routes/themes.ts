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
import { db, themes, users, eq, and, desc } from '@counter/db';
import { createThemeSchema, paginationQuerySchema, themeVariablesSchema } from '@counter/types';
import type { Page, Theme, ThemeVariables } from '@counter/types';
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
