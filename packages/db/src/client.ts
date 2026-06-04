import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as schema from './schema.ts';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbInstance {
  sql: Sql;
  db: Database;
}

/**
 * Create a database connection.
 *
 * On Cloudflare Workers this is called once per request with the Hyperdrive
 * connection string; `max` stays under the 6-connections-per-invocation limit
 * and the caller closes it with `ctx.waitUntil(instance.sql.end())`. In Node/Bun
 * (migrations, seed) it's a normal pooled client.
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
