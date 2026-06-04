import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Load the monorepo's root `.env` into process.env. Bun only auto-loads `.env`
 * from the current working directory, but our processes start from various
 * package dirs (apps/api, packages/db). Walk up until we find a `.env`.
 * Existing process.env values always win (so real env / CI overrides the file).
 */
export function loadRootEnv(startDir: string = process.cwd()): void {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      for (const line of readFileSync(candidate, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

/**
 * Server-side environment validation. Call loadServerEnv() once at process
 * start (API, db migrations, seed). The web client does NOT use this — it reads
 * PUBLIC_API_URL through Vite's own env handling.
 */
const serverEnvSchema = z.object({
  // Optional: Node/Bun (migrate, seed, local) use this directly. On Cloudflare
  // Workers there is no DATABASE_URL — the connection comes from the Hyperdrive
  // binding at request time instead.
  DATABASE_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_ACCESS_KEY: z.string().optional().default(''),
  S3_SECRET_KEY: z.string().optional().default(''),
  S3_BUCKET: z.string().optional().default(''),
  PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
  // API-specific port. We deliberately do NOT read a bare `PORT`: in a monorepo
  // dev setup the web framework also claims PORT, and some harnesses inject it,
  // which would make the API and web collide on one port. The API's port is
  // derived from PUBLIC_API_URL (or API_PORT) instead — a single source of truth.
  API_PORT: z.coerce.number().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema> & {
  /** The effective port the API should bind. */
  apiPort: number;
};

let cached: ServerEnv | null = null;

/** Pull the port out of a URL, or null if none is present. */
function portFromUrl(url: string): number | null {
  try {
    const p = new URL(url).port;
    return p ? Number(p) : null;
  } catch {
    return null;
  }
}

export function loadServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const apiPort = parsed.data.API_PORT ?? portFromUrl(parsed.data.PUBLIC_API_URL) ?? 3000;
  cached = { ...parsed.data, apiPort };
  return cached;
}
