// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Database connection plumbing for both runtimes Counter targets.
 *
 * The hard problem this solves: on Cloudflare Workers the connection string only
 * exists per-request (via a Hyperdrive binding), so we can't open one client at
 * import time the way a normal Node server would. The fix is to carry the active
 * connection in AsyncLocalStorage and expose an ambient `db` proxy that resolves
 * to it, so services can `import { db }` without threading a handle everywhere.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as schema from './schema.ts';

/** A drizzle handle bound to our schema. This is what query code talks to. */
export type Database = PostgresJsDatabase<typeof schema>;

/** A live connection: the raw postgres client (for teardown) plus its drizzle wrapper. */
export interface DbInstance {
  sql: Sql;
  db: Database;
}

/**
 * Open a database connection.
 *
 * On Workers this runs once per request with a Hyperdrive connection string.
 * Keep `max` under Hyperdrive's cap of 6 connections per invocation, and have
 * the caller close it with `ctx.waitUntil(instance.sql.end())`. On Node/Bun
 * (migrations, seed) it's a normal pooled client with no special teardown.
 *
 * @param connectionString  Postgres URL, either real (Node) or from Hyperdrive (Workers).
 * @param opts.max          Pool size; defaults to 5 to stay under the Hyperdrive cap.
 */
export function createDb(connectionString: string, opts: { max?: number } = {}): DbInstance {
  const sql = postgres(connectionString, {
    max: opts.max ?? 5,
    // Skip the type-introspection round trip; we don't rely on custom array types.
    fetch_types: false,
  });
  return { sql, db: drizzle(sql, { schema }) };
}

/**
 * Per-request database context. Workers can't hold a connection in a module
 * global (the connection string only exists per-request via the Hyperdrive
 * binding), so the active connection is carried in AsyncLocalStorage. This lets
 * every service keep importing the ambient `db` without threading it through.
 */
const store = new AsyncLocalStorage<DbInstance>();

/**
 * Run `fn` with `instance` as the active connection for the whole async call
 * tree underneath it. Anything `fn` triggers that reads the ambient `db` sees
 * this instance, even across awaits.
 */
export function runWithDb<T>(instance: DbInstance, fn: () => T): T {
  return store.run(instance, fn);
}

function activeDb(): Database {
  const instance = store.getStore();
  if (!instance) {
    throw new Error(
      'No database connection in context. Wrap the request/operation in runWithDb(createDb(url), fn).',
    );
  }
  return instance.db;
}

/**
 * The ambient database handle. Resolves to whichever connection `runWithDb`
 * established for the current async context.
 *
 * It's a Proxy because the real connection doesn't exist at import time; every
 * property access reaches into the current context's drizzle instance on demand.
 * Methods get bound to that instance so `this` stays correct once they're pulled
 * off the proxy and called.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    const real = activeDb() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
});
