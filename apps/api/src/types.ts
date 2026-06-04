/** Cloudflare Worker bindings available on the request (c.env). */
export interface WorkerBindings {
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_EXPIRES_IN?: string;
  JWT_REFRESH_EXPIRES_IN?: string;
  PUBLIC_API_URL?: string;
  /** Present in Node/Bun (local, tests). On Workers the DB comes from HYPERDRIVE. */
  DATABASE_URL?: string;
  /** Hyperdrive binding — provides a pooled connection string at request time. */
  HYPERDRIVE?: { connectionString: string };
}

/** Shared Hono environment: bindings + variables set by middleware. */
export interface AppEnv {
  Bindings: WorkerBindings;
  Variables: {
    /** Set by auth middleware when a valid access token is present. */
    userId?: string;
  };
}
