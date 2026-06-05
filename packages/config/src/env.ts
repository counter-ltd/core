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
  // 64-char hex AES-256 key for encrypting at-rest fields (message bodies, email,
  // OAuth tokens, push tokens). Optional with an empty default so migrate/seed/
  // tests that never encrypt still load; the crypto helpers throw if a real
  // encrypt/decrypt runs against an empty key. Set via `wrangler secret put`.
  MESSAGE_ENCRYPTION_KEY: z.string().optional().default(''),
  // 64-char hex HMAC key for blind indexes (email + push token lookups). Kept
  // separate from MESSAGE_ENCRYPTION_KEY so the two never share fate. Generate
  // with `openssl rand -hex 32`.
  BLIND_INDEX_KEY: z.string().optional().default(''),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_ACCESS_KEY: z.string().optional().default(''),
  S3_SECRET_KEY: z.string().optional().default(''),
  S3_BUCKET: z.string().optional().default(''),
  // Public origin the R2 media bucket is served from (custom domain, e.g.
  // https://media.counter.ltd). Stored media/avatar URLs are built as
  // `${MEDIA_PUBLIC_URL}/objects/{sha256}`. Defaults to a localhost stand-in so
  // dev still produces well-formed URLs even before the bucket has a domain.
  MEDIA_PUBLIC_URL: z.string().optional().default('http://localhost:3000/media-local'),
  // Apple Push credentials. All optional: when any is missing we simply don't
  // send push (local dev and tests run without them), so the inbox still works.
  // APNS_AUTH_KEY holds the .p8 contents (PEM or bare base64; the sender strips
  // headers either way). APNS_HOST lets staging point at Apple's sandbox.
  APNS_KEY_ID: z.string().optional().default(''),
  APNS_TEAM_ID: z.string().optional().default(''),
  APNS_BUNDLE_ID: z.string().optional().default(''),
  APNS_AUTH_KEY: z.string().optional().default(''),
  APNS_HOST: z.string().optional().default('https://api.push.apple.com'),
  // Web Push (VAPID) credentials. All optional: when any is missing we skip web
  // push, so local dev and tests run without them. The keys are an EC P-256 pair
  // shared by every subscription. VAPID_PUBLIC_KEY is the base64url uncompressed
  // point (the same value the browser passes to pushManager.subscribe), and
  // VAPID_PRIVATE_KEY is the base64url 32-byte scalar. Generate a pair with
  // `npx web-push generate-vapid-keys`. VAPID_SUBJECT is a mailto: or https URL
  // identifying the sender, required by the spec.
  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
  VAPID_SUBJECT: z.string().optional().default('mailto:push@counter.ltd'),
  // OAuth app credentials. All optional: when absent the OAuth endpoints return
  // an error rather than starting a broken flow. Set via `wrangler secret put`
  // in production; add to .dev.vars locally when testing the OAuth flows.
  GITHUB_CLIENT_ID: z.string().optional().default(''),
  GITHUB_CLIENT_SECRET: z.string().optional().default(''),
  DISCORD_CLIENT_ID: z.string().optional().default(''),
  DISCORD_CLIENT_SECRET: z.string().optional().default(''),
  // Thing Two bot credentials. Optional: when absent the bot delivery is skipped.
  // Set via `wrangler secret put` in production; add to .dev.vars locally.
  DISCORD_BOT_TOKEN: z.string().optional().default(''),
  DISCORD_GUILD_ID: z.string().optional().default(''),
  // Required for the Discord interactions endpoint (slash commands + context
  // menus). DISCORD_APP_ID identifies the application when registering commands;
  // DISCORD_PUBLIC_KEY is the Ed25519 key Discord uses to sign every interaction
  // payload, which we verify before trusting any incoming request.
  DISCORD_APP_ID: z.string().optional().default(''),
  DISCORD_PUBLIC_KEY: z.string().optional().default(''),
  // OpenAI-compatible chat endpoint powering Thing Two's /ask command. Optional:
  // when OPENAI_BASE_URL is missing, /ask politely declines.
  // OPENAI_BASE_URL is the API root WITHOUT a trailing /chat/completions (e.g.
  // https://api.openai.com/v1); the handler appends the path. Any OpenAI-shaped
  // provider works. Set via `wrangler secret put` in production.
  OPENAI_BASE_URL: z.string().optional().default(''),
  // Static bearer key. Used when no Google service account is configured. Leave
  // empty when authenticating to Vertex AI via the service account below.
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().optional().default('gpt-4o-mini'),
  // Google service account for Vertex AI's OpenAI-compatible endpoint. When
  // GOOGLE_SA_PRIVATE_KEY is set, the /ask handler mints a short-lived OAuth
  // access token (signed JWT, cached ~1h) and uses it as the bearer instead of
  // OPENAI_API_KEY. Needed because org policy here disallows static API keys.
  // The private key may contain literal "\n" (as in the SA JSON); the auth code
  // normalizes them. Set via `wrangler secret put` in production.
  GOOGLE_SA_CLIENT_EMAIL: z.string().optional().default(''),
  GOOGLE_SA_PRIVATE_KEY: z.string().optional().default(''),
  // Thing Two's system prompt for /ask. Kept out of the repo on purpose (the bot
  // lore is private), so it is loaded from secrets rather than imported from code.
  // Cloudflare caps a single text secret at ~5 kB and the prompt is larger, so it
  // is split across two secrets and concatenated at use. Set both with
  // scripts/deploy-ask-prompt.sh, which reads private/thing-personas.mjs. Empty
  // falls back to a bland in-code default so /ask still answers.
  THING_TWO_SYSTEM_PROMPT: z.string().optional().default(''),
  THING_TWO_SYSTEM_PROMPT_2: z.string().optional().default(''),
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
