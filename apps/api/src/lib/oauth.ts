// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * OAuth provider integrations: state management, code exchange, user fetching,
 * and the account find-or-create logic that turns a provider identity into a
 * Counter session.
 *
 * Everything token-related is kept out of URLs. State tokens use SHA-256 hashes
 * stored in the DB (same pattern as refresh tokens). After a successful login
 * callback the client gets a short-lived opaque session code rather than the
 * real JWT pair, which it exchanges via POST /auth/session/exchange. That way
 * live credentials never appear in a redirect URL or server log.
 */
import {
  db,
  users,
  integrations,
  oauthAccounts,
  oauthStates,
  oauthSessionCodes,
  eq,
  and,
} from '@counter/db';
import { encryptMessage, decryptMessage, sha256Hex, blindIndex, encryptField } from './crypto.ts';
import { loadServerEnv } from '@counter/config/env';
import { errors } from './errors.ts';
import type { OAuthProvider } from '@counter/types';
import type { WorkerBindings } from '../types.ts';

// --- provider config ---

interface ProviderConfig {
  authUrl: string;
  tokenUrl: string;
  userUrl: string;
  scopes: string;
  clientId: (env: WorkerBindings) => string | undefined;
  clientSecret: (env: WorkerBindings) => string | undefined;
}

/** Supported OAuth provider definitions. */
export const PROVIDERS: Record<OAuthProvider, ProviderConfig> = {
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userUrl: 'https://api.github.com/user',
    scopes: 'read:user user:email',
    clientId: (env) => env.GITHUB_CLIENT_ID,
    clientSecret: (env) => env.GITHUB_CLIENT_SECRET,
  },
  discord: {
    authUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userUrl: 'https://discord.com/api/users/@me',
    scopes: 'identify email',
    clientId: (env) => env.DISCORD_CLIENT_ID,
    clientSecret: (env) => env.DISCORD_CLIENT_SECRET,
  },
};

// --- state tokens ---

// 10 minutes: enough to survive a slow browser, short enough that an expired
// state can't be replayed in any meaningful attack window.
const STATE_TTL_MS = 10 * 60 * 1000;

/** 256-bit random hex, safe to put in a URL query param. */
function randomHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the provider's authorization URL including the state param and scopes.
 *
 * @param provider    Which platform to authorize against.
 * @param state       The plain state token (not hashed) to embed in the URL.
 * @param redirectUri The callback URL registered with the provider.
 * @param env         Worker bindings, used to read the client ID.
 */
export function buildAuthUrl(
  provider: OAuthProvider,
  state: string,
  redirectUri: string,
  env: WorkerBindings,
): string {
  const config = PROVIDERS[provider];
  const clientId = config.clientId(env);
  if (!clientId) throw errors.internal(`${provider} OAuth is not configured`);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: config.scopes,
    state,
  });
  // Discord needs response_type explicitly; GitHub ignores it but it's harmless.
  if (provider === 'discord') params.set('response_type', 'code');

  return `${config.authUrl}?${params}`;
}

/**
 * Issue a CSRF state token and persist its hash.
 *
 * @param provider  Which provider this flow is for.
 * @param action    'login' for unauthenticated sign-in, 'connect' to link an
 *                  existing account.
 * @param userId    Required when action is 'connect'; null for login flows.
 * @returns         The raw state token to embed in the redirect URL.
 */
export async function storeOAuthState(
  provider: OAuthProvider,
  action: 'login' | 'connect' | 'mobile_login' | 'mobile_connect',
  userId?: string,
): Promise<string> {
  const state = randomHex();
  await db.insert(oauthStates).values({
    stateHash: await sha256Hex(state),
    provider,
    action,
    userId: userId ?? null,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  return state;
}

/**
 * Consume and validate a CSRF state token from the callback.
 *
 * Deletes the row on the way out whether or not it's expired, so stale states
 * don't accumulate in the table.
 *
 * @param state  The raw state token from the callback query param.
 * @returns      The stored `{provider, action, userId}`.
 * @throws       401 if the state is unknown or expired.
 */
export async function consumeOAuthState(state: string): Promise<{
  provider: OAuthProvider;
  action: 'login' | 'connect' | 'mobile_login' | 'mobile_connect';
  userId: string | null;
}> {
  const row = await db.query.oauthStates.findFirst({
    where: eq(oauthStates.stateHash, await sha256Hex(state)),
  });

  if (row) {
    await db.delete(oauthStates).where(eq(oauthStates.id, row.id));
  }

  if (!row || row.expiresAt.getTime() < Date.now()) {
    throw errors.unauthorized('OAuth state is invalid or expired');
  }

  return {
    provider: row.provider as OAuthProvider,
    action: row.action as 'login' | 'connect',
    userId: row.userId,
  };
}

// --- code exchange ---

/**
 * Exchange an authorization code for an access token (and optional refresh token).
 *
 * GitHub responds with a URL-encoded body; Discord responds with JSON. Both
 * return an `access_token` field after normalization.
 *
 * @param provider    Which provider to call.
 * @param code        The `code` param from the callback.
 * @param redirectUri Must match the URI used in the initial redirect.
 * @param env         Worker bindings for client credentials.
 * @returns           Raw tokens from the provider.
 */
export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
  env: WorkerBindings,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const config = PROVIDERS[provider];
  const clientId = config.clientId(env);
  const clientSecret = config.clientSecret(env);
  if (!clientId || !clientSecret) throw errors.internal(`${provider} OAuth is not configured`);

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // GitHub defaults to URL-encoded; requesting JSON normalizes both providers.
      Accept: 'application/json',
    },
    body,
  });

  if (!res.ok) throw errors.internal(`${provider} token exchange failed`);

  const data = (await res.json()) as Record<string, unknown>;
  const accessToken = data.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw errors.internal(`${provider} did not return an access token`);
  }

  const refreshToken =
    typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : null;

  return { accessToken, refreshToken };
}

// --- provider user fetching ---

interface GitHubUser {
  id: number;
  login: string;
  email: string | null;
  html_url: string;
  name: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * Fetch the authenticated GitHub user's profile.
 *
 * Falls back to the emails endpoint when the profile omits the email (as it
 * does when GitHub privacy settings hide the primary address from the profile
 * API but the `user:email` scope still lets us read it directly).
 */
export async function getGitHubUser(
  accessToken: string,
): Promise<{ id: string; login: string; email: string | null; htmlUrl: string }> {
  const ghHeaders = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'counter-app',
  };

  const res = await fetch('https://api.github.com/user', { headers: ghHeaders });
  if (!res.ok) throw errors.internal('Failed to fetch GitHub user');
  const user = (await res.json()) as GitHubUser;

  let email = user.email;
  if (!email) {
    // Profile email is hidden; pull the verified primary from the emails list.
    const emailRes = await fetch('https://api.github.com/user/emails', { headers: ghHeaders });
    if (emailRes.ok) {
      const emails = (await emailRes.json()) as GitHubEmail[];
      email = emails.find((e) => e.primary && e.verified)?.email ?? null;
    }
  }

  return { id: String(user.id), login: user.login, email, htmlUrl: user.html_url };
}

/**
 * Fetch the authenticated Discord user's profile.
 */
export async function getDiscordUser(accessToken: string): Promise<{
  id: string;
  username: string;
  email: string | null;
  // Avatar hash and display name carried through so the caller can ingest the
  // user's pfp into our media storage on link. Null when they have no avatar.
  avatar: string | null;
  globalName: string | null;
}> {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw errors.internal('Failed to fetch Discord user');
  const user = (await res.json()) as {
    id: string;
    username: string;
    email?: string;
    avatar?: string | null;
    global_name?: string | null;
  };
  return {
    id: user.id,
    username: user.username,
    email: user.email ?? null,
    avatar: user.avatar ?? null,
    globalName: user.global_name ?? null,
  };
}

// --- account linking ---

/**
 * Upsert an OAuth credential row, encrypting tokens before storing.
 *
 * @param userId        Counter user ID.
 * @param provider      'github' | 'discord'.
 * @param providerUser  Normalized profile from the provider API.
 * @param tokens        Raw tokens from the code exchange.
 * @param encKey        MESSAGE_ENCRYPTION_KEY from Worker bindings.
 */
export async function upsertOAuthAccount(
  userId: string,
  provider: OAuthProvider,
  providerUser: { id: string; username: string; email: string | null },
  tokens: { accessToken: string; refreshToken: string | null },
  encKey: string,
): Promise<void> {
  // Guard against linking a provider account that's already claimed by a
  // different Counter user. The (provider, providerUserId) unique index would
  // catch this at the DB level, but the constraint error is opaque to callers.
  const claimed = await db.query.oauthAccounts.findFirst({
    where: and(
      eq(oauthAccounts.provider, provider),
      eq(oauthAccounts.providerUserId, providerUser.id),
    ),
  });
  if (claimed && claimed.userId !== userId) {
    throw errors.conflict(`This ${provider} account is already linked to another Counter account.`);
  }

  const accessToken = await encryptMessage(tokens.accessToken, encKey);
  const refreshToken = tokens.refreshToken
    ? await encryptMessage(tokens.refreshToken, encKey)
    : null;
  // Provider email is encrypted at rest like the user's own. Null stays null.
  const providerEmail = providerUser.email
    ? await encryptField(providerUser.email, encKey)
    : null;

  await db
    .insert(oauthAccounts)
    .values({
      userId,
      provider,
      providerUserId: providerUser.id,
      providerUsername: providerUser.username,
      providerEmail,
      accessToken,
      refreshToken,
    })
    .onConflictDoUpdate({
      // Conflict on (userId, provider): same user re-linking the same platform
      // updates the stored credential rather than duplicating the row.
      target: [oauthAccounts.userId, oauthAccounts.provider],
      set: {
        providerUserId: providerUser.id,
        providerUsername: providerUser.username,
        providerEmail,
        accessToken,
        refreshToken,
        updatedAt: new Date(),
      },
    });
}

/**
 * Upsert an `integrations` row for the provider and mark it verified.
 *
 * OAuth proves account ownership more strongly than rel="me", so we set
 * verified=true immediately. Disconnecting will set it back to false.
 */
export async function autoVerifyIntegration(
  userId: string,
  provider: OAuthProvider,
  providerUser: { username: string; id: string },
): Promise<void> {
  const platformUrl =
    provider === 'github'
      ? `https://github.com/${providerUser.username}`
      : `https://discord.com/users/${providerUser.id}`;

  await db
    .insert(integrations)
    .values({
      userId,
      platform: provider,
      platformUsername: providerUser.username,
      platformUrl,
      verified: true,
    })
    .onConflictDoUpdate({
      target: [integrations.userId, integrations.platform],
      set: {
        platformUsername: providerUser.username,
        platformUrl,
        verified: true,
        updatedAt: new Date(),
      },
    });
}

// --- user find-or-create ---

/**
 * Resolve or create a Counter user for an OAuth identity.
 *
 * Resolution order:
 *  1. `oauthAccounts` row for (provider, providerUserId) — existing linked account.
 *  2. Counter user with matching email — link without creating a new account.
 *  3. Neither — create a new Counter user derived from the provider profile.
 *
 * @returns `{userId, isNew}` where isNew is true only for case 3.
 */
export async function findOrCreateOAuthUser(
  provider: OAuthProvider,
  providerUser: { id: string; username: string; email: string | null },
): Promise<{ userId: string; isNew: boolean }> {
  // Case 1: already linked.
  const existing = await db.query.oauthAccounts.findFirst({
    where: and(
      eq(oauthAccounts.provider, provider),
      eq(oauthAccounts.providerUserId, providerUser.id),
    ),
  });
  if (existing) return { userId: existing.userId, isNew: false };

  const env = loadServerEnv();

  // Case 2: email match — link provider to existing account. Email is encrypted
  // at rest, so match on its blind index, not the ciphertext column.
  if (providerUser.email) {
    const emailIndex = await blindIndex(providerUser.email.toLowerCase(), env.BLIND_INDEX_KEY);
    const byEmail = await db.query.users.findFirst({
      where: eq(users.emailIndex, emailIndex),
    });
    if (byEmail) return { userId: byEmail.id, isNew: false };
  }

  // Case 3: create a new Counter account.
  const username = await deriveUsername(providerUser.username);
  // Email is required on the users table. Generate a placeholder if the provider
  // withholds it (rare for GitHub/Discord with the scopes we request, but possible).
  const loweredEmail = providerUser.email?.toLowerCase() ?? `${username}@oauth.counter.ltd`;
  const emailIndex = await blindIndex(loweredEmail, env.BLIND_INDEX_KEY);
  const email = await encryptField(loweredEmail, env.MESSAGE_ENCRYPTION_KEY);

  const [created] = await db
    .insert(users)
    .values({ username, email, emailIndex, passwordHash: null, displayName: providerUser.username })
    .returning();

  if (!created) throw errors.internal('Failed to create account');
  return { userId: created.id, isNew: true };
}

/**
 * Derive a valid Counter username from a provider handle.
 *
 * Strips characters outside `[a-z0-9_]`, clamps to 20 chars, pads to the
 * 3-char minimum, and appends an incrementing suffix if the result is taken.
 */
export async function deriveUsername(handle: string): Promise<string> {
  const base = handle
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20)
    .padEnd(3, 'x'); // pad short handles to hit the 3-char minimum

  const taken = await db.query.users.findFirst({ where: eq(users.username, base) });
  if (!taken) return base;

  for (let i = 2; i <= 99; i++) {
    const candidate = `${base.slice(0, 17)}${i}`;
    const row = await db.query.users.findFirst({ where: eq(users.username, candidate) });
    if (!row) return candidate;
  }

  // Last resort: random suffix so signup never gets permanently stuck.
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `${base.slice(0, 14)}${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// --- session codes (login flow only) ---

// 5 minutes: long enough to survive a slow page load; short enough that a
// leaked code URL is quickly useless.
const SESSION_CODE_TTL_MS = 5 * 60 * 1000;

/**
 * Issue a one-time session code for the login callback redirect.
 *
 * The code is stored as a SHA-256 hash so a DB leak can't be exchanged for
 * tokens. It expires in 5 minutes and is consumed (deleted) on first use.
 *
 * @param userId  The Counter user who just authenticated.
 * @returns       The raw code to embed in the redirect URL.
 */
export async function issueSessionCode(userId: string): Promise<string> {
  const code = randomHex();
  await db.insert(oauthSessionCodes).values({
    codeHash: await sha256Hex(code),
    userId,
    expiresAt: new Date(Date.now() + SESSION_CODE_TTL_MS),
  });
  return code;
}

/**
 * Consume a session code and return the associated user ID.
 *
 * Deletes the row whether or not it has expired, so stale codes don't pile up.
 *
 * @param code  The raw code from the callback URL.
 * @returns     The Counter user ID it was issued for.
 * @throws      401 if the code is unknown or expired.
 */
export async function consumeSessionCode(code: string): Promise<string> {
  const row = await db.query.oauthSessionCodes.findFirst({
    where: eq(oauthSessionCodes.codeHash, await sha256Hex(code)),
  });

  if (row) {
    await db.delete(oauthSessionCodes).where(eq(oauthSessionCodes.id, row.id));
  }

  if (!row || row.expiresAt.getTime() < Date.now()) {
    throw errors.unauthorized('Session code is invalid or expired');
  }

  return row.userId;
}

/**
 * Decrypt a stored OAuth access token for use in provider API calls.
 *
 * @param stored  The encrypted value from `oauthAccounts.accessToken`.
 * @param encKey  MESSAGE_ENCRYPTION_KEY from Worker bindings.
 */
export async function decryptAccessToken(stored: string, encKey: string): Promise<string> {
  return decryptMessage(stored, encKey);
}
