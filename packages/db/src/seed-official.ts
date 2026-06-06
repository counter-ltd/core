// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Populate the official theme catalog. Safe to run against production.
 *
 * Unlike `seed.ts` (which wipes every content table and is dev-only), this script
 * never deletes anything. It finds the catalog's author account and inserts only
 * the official themes that aren't already there, so re-running it is a no-op once
 * the catalog is in place. Run it once after deploying the `official` column.
 *
 * The author defaults to `@counter`; override with `OFFICIAL_AUTHOR=<username>`.
 * That account must already exist (we don't create it here, to keep PII
 * encryption out of this script). Usage:
 *
 *   OFFICIAL_AUTHOR=counter bun run src/seed-official.ts
 */
import { loadRootEnv, loadServerEnv } from '@counter/config/env';

loadRootEnv();
const env = loadServerEnv();
if (!env.DATABASE_URL) throw new Error('DATABASE_URL must be set to populate official themes.');

const { createDb, runWithDb, db } = await import('./client.ts');
const { users, themes } = await import('./schema.ts');
const { eq, and, notInArray } = await import('drizzle-orm');
const { officialThemeRows, officialThemeNames } = await import('./official-themes.ts');

const authorUsername = process.env.OFFICIAL_AUTHOR ?? 'counter';
const instance = createDb(env.DATABASE_URL);

await runWithDb(instance, async () => {
  const author = await db.query.users.findFirst({ where: eq(users.username, authorUsername) });
  if (!author) {
    throw new Error(
      `No account @${authorUsername} to own the official themes. Create that account first, ` +
        `or set OFFICIAL_AUTHOR=<existing username>.`,
    );
  }

  // Skip anything already present, keyed by name, so re-running never duplicates.
  const existing = await db
    .select({ name: themes.name })
    .from(themes)
    .where(and(eq(themes.official, true), eq(themes.userId, author.id)));
  const have = new Set(existing.map((r) => r.name));

  const toInsert = officialThemeRows(author.id).filter((row) => !have.has(row.name));

  // Prune official themes that left the catalog (e.g. a renamed theme), so the
  // catalog stays authoritative. Scoped to this author's official rows, so it
  // never touches community themes. Cascades to anyone's saved_themes row.
  const stale = await db
    .delete(themes)
    .where(
      and(eq(themes.official, true), eq(themes.userId, author.id), notInArray(themes.name, officialThemeNames)),
    )
    .returning({ name: themes.name });

  if (toInsert.length === 0 && stale.length === 0) {
    console.log(`All ${officialThemeNames.length} official themes already in sync for @${authorUsername}.`);
    return;
  }

  if (toInsert.length > 0) {
    await db.insert(themes).values(toInsert);
    console.log(`Inserted ${toInsert.length}: ${toInsert.map((r) => r.name).join(', ')}`);
  }
  if (stale.length > 0) {
    console.log(`Removed ${stale.length} no longer in the catalog: ${stale.map((r) => r.name).join(', ')}`);
  }
  const skipped = officialThemeNames.length - toInsert.length;
  if (skipped > 0) console.log(`Skipped ${skipped} already present.`);
});

await instance.sql.end();
