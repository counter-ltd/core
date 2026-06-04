// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

import { loadServerEnv } from '@counter/config/env';
import { createDb, runWithDb } from '@counter/db';
import { createApp } from './app.ts';
import type { WorkerBindings } from './types.ts';

const app = createApp();

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
export default {
  async fetch(request: Request, env: WorkerBindings, ctx: ExecutionContext): Promise<Response> {
    // loadServerEnv caches after the first call. The bindings are identical for
    // every request to this Worker, so re-seeding is a cheap no-op, not a leak.
    loadServerEnv(env as unknown as Record<string, string | undefined>);

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
};
