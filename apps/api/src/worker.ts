// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Cloudflare Workers entry point for the API.
 *
 * A Worker has no long-lived process to hang globals off, so the per-request
 * setup that a traditional server does once at boot happens here on every
 * request: seed the config cache from the bindings, open a database
 * connection, and run the app inside that connection's context.
 *
 * The same Hono app (createApp) runs locally under Bun; only this request
 * plumbing is Workers-specific.
 */
import { loadServerEnv } from '@counter/config/env';
import { createDb, runWithDb } from '@counter/db';
import { createApp } from './app.ts';
import { setWorkerBindings } from './lib/bindings.ts';
import { sweepStaleObjects } from './services/media.ts';
import type { WorkerBindings } from './types.ts';

// Wrangler discovers Durable Object classes by their named exports from the
// Worker entry point. Without this export the TUNNEL_SIGNALING binding silently
// fails to bind at deploy time, even though the class is imported elsewhere.
export { TunnelSignaling } from './durable-objects/TunnelSignaling.ts';
export { ConversationHub } from './durable-objects/ConversationHub.ts';
export { NotificationHub } from './durable-objects/NotificationHub.ts';

const app = createApp();

export default {
  async fetch(request: Request, env: WorkerBindings, ctx: ExecutionContext): Promise<Response> {
    // loadServerEnv caches after the first call. The bindings are identical for
    // every request to this Worker, so re-seeding is a cheap no-op, not a leak.
    loadServerEnv(env as unknown as Record<string, string | undefined>);
    // Stash the raw bindings so services without a request context (the live
    // notification push) can reach the Durable Object namespaces.
    setWorkerBindings(env);

    // Prefer the Hyperdrive pooled connection on Workers; DATABASE_URL is the
    // direct fallback used in local/test runs where Hyperdrive isn't bound.
    const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
    if (!connectionString) {
      return Response.json(
        { error: { code: 'config_error', message: 'No database connection configured' } },
        { status: 500 },
      );
    }

    // A fresh connection per request: Workers don't share state across requests,
    // and runWithDb stashes this instance in AsyncLocalStorage so the route
    // handlers' `db` calls find it without threading it through every signature.
    const instance = createDb(connectionString);
    const response = await runWithDb(instance, () => app.fetch(request, env, ctx));
    // c.json buffers the whole body, so the response no longer needs the
    // connection once fetch resolves. Close it after the fact via waitUntil so
    // teardown doesn't delay returning the response to the client.
    ctx.waitUntil(instance.sql.end());
    return response;
  },

  // Cron entry point. Wired to the `triggers.crons` schedule in wrangler.jsonc;
  // runs the media garbage collector. Mirrors fetch's per-invocation setup since
  // a scheduled run gets the same cold bindings and needs its own DB connection.
  async scheduled(_event: ScheduledController, env: WorkerBindings, ctx: ExecutionContext): Promise<void> {
    loadServerEnv(env as unknown as Record<string, string | undefined>);
    setWorkerBindings(env);

    const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
    if (!connectionString) return;

    const instance = createDb(connectionString);
    // Hold the connection open until the sweep finishes, then drain it. The sweep
    // deletes from R2 and Postgres, so it must complete before the isolate naps.
    ctx.waitUntil(
      runWithDb(instance, async () => {
        await sweepStaleObjects();
      }).finally(() => instance.sql.end()),
    );
  },
};
