// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * One-shot migration runner. Applies any pending SQL in ../drizzle against
 * DATABASE_URL, then exits. Run by hand or in CI/deploy; never on Workers, where
 * there's no DATABASE_URL and no place to run a long-lived script.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { loadRootEnv, loadServerEnv } from '@counter/config/env';

loadRootEnv();
const env = loadServerEnv();

if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set to run migrations (this is a Node/Bun-only script).');
}

// max:1 because migrations must run in order on one connection; a pool could
// interleave them. We close it explicitly once they're done.
const migrationClient = postgres(env.DATABASE_URL, { max: 1 });

console.log('Running migrations…');
await migrate(drizzle(migrationClient), { migrationsFolder: `${import.meta.dir}/../drizzle` });
console.log('Migrations complete.');

await migrationClient.end();
// Force exit: postgres can leave the event loop alive otherwise, hanging CI.
process.exit(0);
