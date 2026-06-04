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

// Public: browse published themes.
themeRoutes.get('/', async (c) => {
  const { after, limit } = query(c, paginationQuerySchema);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.themes.findFirst({ where: eq(themes.id, after) });
    if (row) cursor = { createdAt: row.createdAt, id: row.id };
  }

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

themeRoutes.post('/', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const input = await body(c, createThemeSchema);
  // Defense in depth: re-validate the variable map structure.
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

themeRoutes.delete('/:id', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const row = await db.query.themes.findFirst({ where: eq(themes.id, id) });
  if (!row) throw errors.notFound('Theme not found');
  if (row.userId !== userId) throw errors.forbidden('You can only delete your own themes');

  await db.delete(themes).where(and(eq(themes.id, id), eq(themes.userId, userId)));
  return c.json({ ok: true });
});
