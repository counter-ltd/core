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
