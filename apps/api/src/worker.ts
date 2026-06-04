import { loadServerEnv } from '@counter/config/env';
import { createDb, runWithDb } from '@counter/db';
import { createApp } from './app.ts';
import type { WorkerBindings } from './types.ts';

const app = createApp();

/**
 * Cloudflare Workers entry point.
 *
 * Each request: populate the config cache from the Worker bindings, open a
 * Hyperdrive-backed DB connection, run the Hono app inside that connection's
 * AsyncLocalStorage context, then close the connection after the response.
 */
export default {
  async fetch(request: Request, env: WorkerBindings, ctx: ExecutionContext): Promise<Response> {
    // Cached after the first call; env is identical for every request to a Worker.
    loadServerEnv(env as unknown as Record<string, string | undefined>);

    const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
    if (!connectionString) {
      return Response.json(
        { error: { code: 'config_error', message: 'No database connection configured' } },
        { status: 500 },
      );
    }

    const instance = createDb(connectionString);
    const response = await runWithDb(instance, () => app.fetch(request, env, ctx));
    // Responses are buffered (c.json), so it's safe to close once fetch resolves.
    ctx.waitUntil(instance.sql.end());
    return response;
  },
};
