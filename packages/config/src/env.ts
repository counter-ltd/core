// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Server-side environment loading and validation. This file uses node:fs, so it
 * is server-only: never import it into the web bundle. Browser-safe constants
 * live in constants.ts, re-exported from the package index.
 *
 * Two jobs here. loadRootEnv() finds and reads the monorepo's shared `.env`,
 * and loadServerEnv() validates what landed in process.env into a typed config.
 */
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Load the monorepo's root `.env` into process.env. Bun only auto-loads `.env`
 * from the current working directory, but our processes start from various
 * package dirs (apps/api, packages/db), so we walk up the tree until we find one.
 *
 * Existing process.env values always win, so real env and CI overrides take
 * precedence over whatever the file says. The 8-level cap stops the walk from
 * running off to the filesystem root if there is no `.env` anywhere.
 *
 * @param startDir  Directory to begin the upward search from; defaults to cwd.
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
 * The shape every server process expects its environment to have. Call
 * loadServerEnv() once at process start (API, db migrations, seed). The web
 * client does NOT use this; it reads PUBLIC_API_URL through Vite's own env
 * handling instead.
 */
const serverEnvSchema = z.object({
  // Optional: Node/Bun (migrate, seed, local) use this directly. On Cloudflare
  // Workers there is no DATABASE_URL; the connection comes from the Hyperdrive
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
  // Apple Push credentials. All optional: when any is missing we simply don't
  // send push (local dev and tests run without them), so the inbox still works.
  // APNS_AUTH_KEY holds the .p8 contents (PEM or bare base64; the sender strips
  // headers either way). APNS_HOST lets staging point at Apple's sandbox.
  APNS_KEY_ID: z.string().optional().default(''),
  APNS_TEAM_ID: z.string().optional().default(''),
  APNS_BUNDLE_ID: z.string().optional().default(''),
  APNS_AUTH_KEY: z.string().optional().default(''),
  APNS_HOST: z.string().optional().default('https://api.push.apple.com'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
  // API-specific port. We deliberately do NOT read a bare `PORT`: in a monorepo
  // dev setup the web framework also claims PORT, and some harnesses inject it,
  // which would make the API and web collide on one port. The API's port is
  // derived from PUBLIC_API_URL (or API_PORT) instead, a single source of truth.
  API_PORT: z.coerce.number().optional(),
});

/** The validated environment, plus the resolved port the rest of the app reads. */
export type ServerEnv = z.infer<typeof serverEnvSchema> & {
  /** The effective port the API should bind. */
  apiPort: number;
};

// Validation is idempotent and the env doesn't change mid-process, so we parse
// once and hand back the same object on every later call.
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

/**
 * Validate the environment and return the typed config, caching the result.
 *
 * On a bad env it throws with every failing variable listed at once, so you fix
 * the whole config in one pass instead of rerunning to find the next mistake.
 *
 * @param source  Where to read raw values from; defaults to process.env. Mainly
 *                a seam for tests to pass a fixed environment.
 */
export function loadServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  // Prefer an explicit API_PORT, fall back to the port in PUBLIC_API_URL, and
  // land on 3000 only if neither is set.
  const apiPort = parsed.data.API_PORT ?? portFromUrl(parsed.data.PUBLIC_API_URL) ?? 3000;
  cached = { ...parsed.data, apiPort };
  return cached;
}
