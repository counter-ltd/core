// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Public entry point for @counter/db. The API imports everything database from
 * here: the schema tables and row types, the connection helpers, and the slice
 * of drizzle-orm query builders it uses.
 *
 * Funnelling the drizzle-orm re-exports through this package means the API
 * depends on @counter/db alone and never pins its own drizzle-orm version, so
 * the query builders and the schema can't drift onto different releases.
 */
export * from './schema.ts';
export { db, createDb, runWithDb, type Database, type DbInstance } from './client.ts';

// Re-export the bits of drizzle-orm the API needs so it has a single dependency.
export {
  eq,
  ne,
  and,
  or,
  not,
  inArray,
  notInArray,
  lt,
  lte,
  gt,
  gte,
  isNull,
  isNotNull,
  desc,
  asc,
  sql,
  count,
  countDistinct,
  ilike,
} from 'drizzle-orm';
export { alias } from 'drizzle-orm/pg-core';
export type { SQL, AnyColumn } from 'drizzle-orm';
