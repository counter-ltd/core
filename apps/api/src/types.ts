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
  /**
   * R2 bucket holding all user media (avatars, post photos). Objects are keyed
   * by the sha256 of their bytes under `objects/{hash}`. Bound in
   * wrangler.jsonc; absent under the plain Bun dev server, so the media service
   * guards on it. See services/media.ts.
   */
  MEDIA?: R2Bucket;
  /**
   * Public origin the MEDIA bucket is served from (custom domain). Used to build
   * the stored, client-facing URLs. Falls back to the config default when unset.
   */
  MEDIA_PUBLIC_URL?: string;
  /** Hyperdrive binding that hands back a pooled connection string per request. */
  HYPERDRIVE?: { connectionString: string };
  /**
   * 64-char hex AES-256 key for encrypting message bodies at rest. Set via
   * `wrangler secret put MESSAGE_ENCRYPTION_KEY`. Generate with:
   *   openssl rand -hex 32
   */
  MESSAGE_ENCRYPTION_KEY: string;
  /**
   * 64-char hex HMAC key for blind indexes that keep encrypted columns (email,
   * push token) queryable. Set via `wrangler secret put BLIND_INDEX_KEY`,
   * generate with `openssl rand -hex 32`. Separate from MESSAGE_ENCRYPTION_KEY
   * so a leak of one key doesn't compromise the other.
   */
  BLIND_INDEX_KEY: string;
  /**
   * Cloudflare Email Sending binding (`send_email` in wrangler.jsonc). Optional
   * because it only exists once the sending domain is onboarded, so local dev
   * and tests run without it and any send is guarded on its presence.
   */
  EMAIL?: EmailBinding;
  /**
   * Apple Push credentials, set as Worker secrets in production. All optional:
   * when absent (local dev, tests, before they're provisioned) push is skipped
   * and the in-app inbox carries on. Read through loadServerEnv, not c.env, so
   * the deep notification path doesn't have to thread the context.
   */
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_BUNDLE_ID?: string;
  /** The .p8 signing key contents (PEM or bare base64). */
  APNS_AUTH_KEY?: string;
  /** Override to point at Apple's sandbox host; defaults to production. */
  APNS_HOST?: string;
  /**
   * GitHub OAuth app credentials. Optional: when absent, the GitHub OAuth
   * endpoints return a 500 rather than starting an unusable flow.
   */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /**
   * Discord OAuth app credentials. Same optionality as GitHub above.
   */
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  /**
   * Cloudflare Calls TURN key for NAT traversal. When absent the API falls back
   * to public STUN only, which covers most NAT types but fails on symmetric NAT.
   * Set via `wrangler secret put TURN_KEY_ID` and `wrangler secret put TURN_KEY_SECRET`.
   */
  TURN_KEY_ID?: string;
  TURN_KEY_SECRET?: string;
  /**
   * Durable Object namespace for Tunnel Talk signaling. One DO instance per
   * active session; keyed by session ID via `idFromName(sessionId)`.
   */
  TUNNEL_SIGNALING: DurableObjectNamespace;
  /**
   * Durable Object namespace for live conversation channels. One instance per
   * conversation, keyed by the two participants' sorted user ids. Optional
   * because Durable Objects only bind under `wrangler dev`; the message routes
   * guard on it so sends still work under the plain Bun dev server (without the
   * live push).
   */
  CONVERSATION_HUB?: DurableObjectNamespace;
  /**
   * Durable Object namespace for the live notification feed. One instance per
   * user, keyed by user id. Optional for the same reason as CONVERSATION_HUB:
   * Durable Objects only bind under `wrangler dev`, and the notification path
   * guards on it so everything still works under the Bun dev server.
   */
  NOTIFICATION_HUB?: DurableObjectNamespace;
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
    // The caller's effective admin permissions, memoised by requirePermission so
    // a route with several permission checks only resolves the union once.
    permissions?: import('@counter/config').Permission[];
  };
}
