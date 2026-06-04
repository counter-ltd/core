// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * drizzle-kit config: where the schema lives, where generated SQL goes, and how
 * to reach the database. drizzle-kit is a local dev/CI tool (generate, migrate,
 * studio), so this only ever runs on Node/Bun where DATABASE_URL exists.
 */
import { defineConfig } from 'drizzle-kit';
import { loadRootEnv, loadServerEnv } from '@counter/config/env';

// Pull in the root .env before reading config; drizzle-kit doesn't do this for us.
loadRootEnv();
const env = loadServerEnv();

// Workers get their connection from a Hyperdrive binding and have no
// DATABASE_URL, but drizzle-kit can't run there anyway. Fail loud if it's missing.
if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set to run drizzle-kit (migrations are Node/Bun-only).');
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  // strict makes drizzle-kit ask before applying destructive changes; verbose
  // prints the SQL it's about to run. Both are worth it for a schema this central.
  strict: true,
  verbose: true,
});
