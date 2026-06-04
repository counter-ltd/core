// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The shape of the environment the API runs against.
 *
 * Hono is generic over an env type so `c.env` and `c.get(...)` stay typed end
 * to end. These interfaces are that contract: what the platform injects
 * (bindings) and what middleware adds along the way (variables).
 */

/**
 * Secrets and bindings the platform injects, reachable as `c.env`.
 *
 * The JWT_* fields back token signing and TTLs. Database access comes from
 * exactly one of two sources depending on where we run, which is why both the
 * Hyperdrive binding and the raw URL are optional here.
 */
export interface WorkerBindings {
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_EXPIRES_IN?: string;
  JWT_REFRESH_EXPIRES_IN?: string;
  PUBLIC_API_URL?: string;
  /** Web app origin, used to build user-facing links (e.g. the email-verify URL). */
  PUBLIC_WEB_URL?: string;
  /** Present in Node/Bun (local, tests). On Workers the DB comes from HYPERDRIVE. */
  DATABASE_URL?: string;
  /** Hyperdrive binding that hands back a pooled connection string per request. */
  HYPERDRIVE?: { connectionString: string };
  /**
   * Cloudflare Email Sending binding (`send_email` in wrangler.jsonc). Optional
   * because it only exists once the sending domain is onboarded, so local dev
   * and tests run without it and any send is guarded on its presence.
   */
  EMAIL?: EmailBinding;
}

/**
 * The slice of the Email Sending binding we actually call.
 *
 * The platform's own type is broader; we narrow it to the high-level `send` so
 * the rest of the code depends on a small, stable shape rather than whichever
 * type name ships in the Workers types.
 */
export interface EmailBinding {
  send(message: {
    to: string;
    from: { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
  }): Promise<unknown>;
}

/**
 * The Hono environment for this app: the platform bindings above plus the
 * request-scoped values middleware sets. Pass this to `new Hono<AppEnv>()` so
 * every handler shares the same typed view of `c.env` and `c.get`/`c.set`.
 */
export interface AppEnv {
  Bindings: WorkerBindings;
  Variables: {
    // Optional because optionalAuth runs everywhere but only fills this in when
    // a valid access token is present. An absent userId means an anonymous call.
    userId?: string;
  };
}
