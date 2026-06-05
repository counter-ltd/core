# Counter

An open source social platform. Like Threads, but fully transparent — open
codebase, open algorithm, **zero individual tracking**, no paywalls, no dark
patterns.

The **API is the product**. The web client is a thin read/write layer over it;
every other client (iOS, macOS, third-party) talks to the same endpoints. No
client holds special privilege.

## Principles (enforced in code, not just docs)

- **No tracking of individuals.** A post view is an anonymous aggregate tick —
  no user id, no IP, no session id ever attached. See `post_views` in
  [`packages/db/src/schema.ts`](packages/db/src/schema.ts).
- **Public by default.** All posts and profiles read without authentication.
- **Insights from post one.** No follower gate on analytics, ever.
- **Open algorithm.** The exact ranking weights are served at `GET /algorithm`
  and shown at [`/algorithm`](http://localhost:5173/algorithm) — the same
  constant the feed ranks with.
- **Everything open.** No proprietary layer. If it runs, it's in this repo.

## Stack

| Layer | Choice |
|-------|--------|
| Runtime | Cloudflare Workers (local dev + tooling via Bun) |
| API | Hono (Workers), Drizzle + postgres-js over **Hyperdrive** |
| Database | PostgreSQL (self-hosted/managed) — fronted by Hyperdrive |
| Web | SvelteKit + `@sveltejs/adapter-cloudflare` (SSR — every page works without JavaScript) |
| iOS | SwiftUI native client (iOS 17+) |
| Auth | Hand-rolled JWT, PBKDF2 password hashing, SHA-256 token hashes (WebCrypto only — no Node/Bun crypto) |
| Realtime | Cloudflare Durable Objects (ConversationHub, NotificationHub, TunnelSignaling) |
| Push | APNs (iOS), Web Push RFC 8291 (browser) |
| Storage | Cloudflare R2 — content-addressed media objects, SHA-256 keyed |
| Bot | Node.js + discord.js on Cloud Run (Thing Two gateway) |
| Validation | Zod (shared between API and client) |

## Layout

```
core/
  apps/
    api/        Hono on Workers (wrangler)   → http://localhost:3000
    web/        SvelteKit on Workers          → http://localhost:5173
    ios/        SwiftUI native client (iOS 17+)
    bot/        Thing Two gateway bot (Node + discord.js, Cloud Run)
  packages/
    db/         Drizzle schema, migrations, client, seed
    types/      Shared Zod schemas + TypeScript types
    config/     Env validation, constants, the ranking algorithm
```

Both apps run on **Cloudflare Workers**. The API reaches Postgres through a
**Hyperdrive** binding (`env.HYPERDRIVE.connectionString`); each request opens a
short-lived `postgres-js` connection carried via `AsyncLocalStorage`. Passwords
are hashed with WebCrypto PBKDF2 and refresh tokens are SHA-256 hashed — no
Node/Bun-only crypto. Migrations and seeding still run locally on Bun against
your Postgres directly (`DATABASE_URL`).

## Run it locally

Prerequisites: [Bun](https://bun.sh) (tooling/migrations) and a PostgreSQL you
can reach. `wrangler dev` runs the Workers locally via `workerd`.

```bash
# 1. Create the DB + env (generates JWT secrets, copies them to the API's .dev.vars)
createdb counter && cp .env.example .env && \
  sed -i '' "s|^JWT_SECRET=|JWT_SECRET=$(openssl rand -hex 32)|; s|^JWT_REFRESH_SECRET=|JWT_REFRESH_SECRET=$(openssl rand -hex 32)|" .env && \
  printf "JWT_SECRET=%s\nJWT_REFRESH_SECRET=%s\n" \
    "$(grep ^JWT_SECRET= .env | cut -d= -f2-)" \
    "$(grep ^JWT_REFRESH_SECRET= .env | cut -d= -f2-)" > apps/api/.dev.vars

# 2. Point the API's Hyperdrive *local* connection at your Postgres
#    Edit apps/api/wrangler.jsonc → hyperdrive[0].localConnectionString
#    (workerd requires a password segment even for trust-auth: postgres://user:any@host:5432/counter)

# 3. Install deps, run migrations, seed sample data
bun run setup

# 4. Start the API (wrangler dev) and web (vite) together
bun run dev
```

Open <http://localhost:5173>. Seeded logins: **ada**, **linus**, or **grace**
— password `password123`.

> On Linux use `sed -i` without the `''`. The API reads secrets from
> `apps/api/.dev.vars` (gitignored); the web reads `PUBLIC_API_URL` from `.env`.

## Deploy to Cloudflare

```bash
# 1. Create a Hyperdrive config pointing at your Postgres, then put its id in
#    apps/api/wrangler.jsonc → hyperdrive[0].id
wrangler hyperdrive create counter-db --connection-string="postgres://user:pass@host:5432/counter"

# 2. Set the API secrets in production
cd apps/api && wrangler secret put JWT_SECRET && wrangler secret put JWT_REFRESH_SECRET
# Encryption keys for at-rest PII (email addresses, push tokens). Generate each with:
#   openssl rand -hex 32
wrangler secret put MESSAGE_ENCRYPTION_KEY && wrangler secret put BLIND_INDEX_KEY

# 3. Run migrations against your Postgres (from your machine)
bun run db:migrate            # and optionally: bun run db:seed

# 4. Deploy both Workers
cd apps/api && wrangler deploy
cd ../web   && bun run deploy   # vite build + wrangler deploy
```

After deploy, set the web's `PUBLIC_API_URL` (in `apps/web/wrangler.jsonc` vars)
to the API Worker's URL, and the API's `PUBLIC_API_URL` to its own URL.

> Cloudflare doesn't host Postgres — bring your own (Neon, Supabase, RDS, …) and
> front it with Hyperdrive for pooling + edge caching.

### Useful scripts

| Command | What it does |
|---------|--------------|
| `bun run dev` | Run API (wrangler) + web (vite) together |
| `bun run dev:api` / `bun run dev:web` | Run just one |
| `bun run db:generate` | Generate a migration from schema changes |
| `bun run db:migrate` | Apply migrations to `DATABASE_URL` |
| `bun run db:seed` | Reset + seed sample data |
| `bun run typecheck` | Typecheck every package |

## API

Base URL `http://localhost:3000`. JSON everywhere. Errors are always
`{ "error": { "code", "message" } }`. Pagination is cursor-based
(`?after=<id>&limit=<n>`, default 20, max 100). Every response carries
`X-RateLimit-*` headers. Auth via `Authorization: Bearer <token>`.

Endpoint groups: `/auth`, `/users`, `/posts`, `/media`, `/search`, `/tags`,
`/topics`, `/notifications`, `/insights`, `/themes`, `/algorithm`,
`/messages`, `/devices`, `/web-push`, `/integrations`, `/tunnel`,
`/discord-bot`, `/reports`, `/admin`, `/preview`. Public endpoints work
unauthenticated and never redirect to login.

## Theming

The design language is **liquid glass**, expressed entirely as CSS custom
properties in [`apps/web/src/app.css`](apps/web/src/app.css). A theme is just an
override map of those variables — validated server-side, never executed. Browse
and apply community themes at [`/themes`](http://localhost:5173/themes).

## License

Counter is licensed under the **Counter Social License (CSL) v1.0** — see
[`LICENSE.md`](LICENSE.md) for the full text. It is source-available, not a
standard open source license: you may use, study, modify, and deploy it, but
network deployments must publish their full source, every deployment must carry
the "Built with Counter" attribution, and individual tracking, profit
extraction, and closed forks are prohibited outright.

Every source file carries the CSL notice header. Data collection is documented
in full — every category, its purpose, and its retention — in
[`documents/DATA-MODEL.md`](../documents/DATA-MODEL.md). The ranking algorithm
and its complete change history are public at
[`/algorithm`](http://localhost:5173/algorithm).
