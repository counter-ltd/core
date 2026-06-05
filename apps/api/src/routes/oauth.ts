// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * OAuth platform integration endpoints: connect GitHub or Discord to a Counter
 * account, sign in via either provider, and manage linked credentials.
 *
 * Two actions share the callback routes but diverge on what happens after:
 *  - 'login'   — unauthenticated; finds/creates a Counter user, issues a
 *                short-lived session code, redirects to the web login callback.
 *  - 'connect' — requires an existing session; links the provider to the
 *                current user and auto-verifies their profile integration badge.
 *
 * On any callback error the handler redirects rather than returning JSON, so
 * the browser always lands on a usable page instead of a raw error response.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { db, oauthAccounts, integrations, eq, and } from '@counter/db';
import { sessionExchangeSchema, oauthConnectPrepareSchema } from '@counter/types';
import type {
  AuthResponse,
  OAuthConnectedAccount,
  OAuthConnectPrepareResponse,
  OAuthProvider,
} from '@counter/types';
import { body } from '../lib/validate.ts';
import { errors, AppError } from '../lib/errors.ts';
import { issueTokens } from '../lib/auth.ts';
import {
  PROVIDERS,
  buildAuthUrl,
  storeOAuthState,
  consumeOAuthState,
  exchangeCode,
  getGitHubUser,
  getDiscordUser,
  findOrCreateOAuthUser,
  upsertOAuthAccount,
  autoVerifyIntegration,
  issueSessionCode,
  consumeSessionCode,
} from '../lib/oauth.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import { getPrivateUser } from '../services/userquery.ts';
import { syncDiscordAvatar } from '../services/discord-avatar.ts';
import type { DiscordUser } from '../services/discord-post.ts';
import { decryptField } from '../lib/crypto.ts';
import type { AppEnv } from '../types.ts';

export const oauthRoutes = new Hono<AppEnv>();

// --- helpers ---

/** Absolute callback URL for a given provider, on the web domain (counter.ltd).
 *
 * Providers redirect to this URL after the user approves. It must live on the
 * web domain so the registered redirect URI is counter.ltd rather than the
 * API subdomain. The SvelteKit callback route proxies the code/state back to
 * the API to complete the exchange.
 */
function callbackUrl(provider: OAuthProvider, webUrl: string): string {
  return `${webUrl}/auth/${provider}/callback`;
}

/** Where to send the browser after a successful or failed connect flow. */
function connectRedirect(webUrl: string, provider: OAuthProvider, error?: string): string {
  const base = `${webUrl}/settings`;
  return error
    ? `${base}?oauthError=${encodeURIComponent(error)}`
    : `${base}?connected=${provider}`;
}

/** Where to send the browser after a successful or failed login flow. */
function loginRedirect(webUrl: string, provider: OAuthProvider, code?: string, error?: string): string {
  const base = `${webUrl}/auth/callback`;
  if (error) return `${base}?error=${encodeURIComponent(error)}`;
  return `${base}?provider=${provider}&code=${code}`;
}

// --- start routes ---

// Anonymous: begin a sign-in/sign-up flow via the provider.
// Pass ?mobile=true from iOS so the callback redirects to the counter:// scheme
// instead of the web URL, letting ASWebAuthenticationSession catch it.
oauthRoutes.get('/github', async (c) => {
  const webUrl = c.env.PUBLIC_WEB_URL ?? 'https://counter.ltd';
  const mobile = c.req.query('mobile') === 'true';
  const state = await storeOAuthState('github', mobile ? 'mobile_login' : 'login');
  return c.redirect(buildAuthUrl('github', state, callbackUrl('github', webUrl), c.env));
});

oauthRoutes.get('/discord', async (c) => {
  const webUrl = c.env.PUBLIC_WEB_URL ?? 'https://counter.ltd';
  const mobile = c.req.query('mobile') === 'true';
  const state = await storeOAuthState('discord', mobile ? 'mobile_login' : 'login');
  return c.redirect(buildAuthUrl('discord', state, callbackUrl('discord', webUrl), c.env));
});

// Authenticated web connect (browser navigates here with a cookie session).
// iOS uses POST /:provider/connect/prepare instead so it can pass a Bearer token.
oauthRoutes.get('/github/connect', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const webUrl = c.env.PUBLIC_WEB_URL ?? 'https://counter.ltd';
  const state = await storeOAuthState('github', 'connect', userId);
  return c.redirect(buildAuthUrl('github', state, callbackUrl('github', webUrl), c.env));
});

oauthRoutes.get('/discord/connect', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const webUrl = c.env.PUBLIC_WEB_URL ?? 'https://counter.ltd';
  const state = await storeOAuthState('discord', 'connect', userId);
  return c.redirect(buildAuthUrl('discord', state, callbackUrl('discord', webUrl), c.env));
});

// --- callback handler (shared logic) ---

async function handleCallback(
  provider: OAuthProvider,
  c: Context<AppEnv>,
): Promise<Response> {
  const webUrl = c.env.PUBLIC_WEB_URL ?? 'https://counter.ltd';

  const stateParam = c.req.query('state');
  const code = c.req.query('code');
  const oauthError = c.req.query('error');

  // Provider declined (user cancelled, etc.). action is unknown at this point,
  // so redirect to a neutral error destination.
  if (oauthError || !stateParam || !code) {
    return c.redirect(`${webUrl}/auth/callback?error=${encodeURIComponent(oauthError ?? 'OAuth cancelled')}`);
  }

  let action: 'login' | 'connect' | 'mobile_login' | 'mobile_connect';
  let linkedUserId: string | null;

  try {
    const stateData = await consumeOAuthState(stateParam);
    action = stateData.action;
    linkedUserId = stateData.userId;
  } catch {
    // Invalid or expired state — can't trust this callback.
    return c.redirect(`${webUrl}/auth/callback?error=${encodeURIComponent('Invalid OAuth state')}`);
  }

  const encKey = c.env.MESSAGE_ENCRYPTION_KEY;
  const redirect = (err?: string) =>
    action === 'connect'
      ? connectRedirect(webUrl, provider, err)
      : loginRedirect(webUrl, provider, undefined, err);

  try {
    const tokens = await exchangeCode(provider, code, callbackUrl(provider, webUrl), c.env);

    // Normalize both providers to a common { id, username, email } shape.
    // GitHub uses `login` for the handle; Discord already uses `username`.
    // For Discord we also hold onto the avatar hash so we can ingest the pfp.
    let discordProfile: DiscordUser | null = null;
    const providerUser = await (async () => {
      if (provider === 'github') {
        const u = await getGitHubUser(tokens.accessToken);
        return { id: u.id, username: u.login, email: u.email };
      }
      const u = await getDiscordUser(tokens.accessToken);
      discordProfile = { id: u.id, username: u.username, global_name: u.globalName, avatar: u.avatar };
      return { id: u.id, username: u.username, email: u.email };
    })();

    // For the connect flow, we know exactly which Counter user to link to.
    // For login, we resolve or create one.
    const userId =
      action === 'connect' && linkedUserId
        ? linkedUserId
        : (await findOrCreateOAuthUser(provider, providerUser)).userId;

    await upsertOAuthAccount(userId, provider, providerUser, tokens, encKey);
    await autoVerifyIntegration(userId, provider, providerUser);
    // Ingest the freshly-linked Discord account's avatar so a later share (or
    // anything reading the profile cache) already has the pfp in our storage.
    if (discordProfile) await syncDiscordAvatar(discordProfile);

    if (action === 'connect') {
      return c.redirect(connectRedirect(webUrl, provider));
    }
    // Mobile connect: ASWebAuthenticationSession catches the counter:// scheme.
    if (action === 'mobile_connect') {
      return c.redirect(`counter://auth/connect?provider=${provider}`);
    }

    const sessionCode = await issueSessionCode(userId);
    // Mobile login: redirect to the custom scheme so ASWebAuthenticationSession
    // intercepts it. Web login goes to the web callback page instead.
    if (action === 'mobile_login') {
      return c.redirect(`counter://auth/callback?provider=${provider}&code=${sessionCode}`);
    }
    return c.redirect(loginRedirect(webUrl, provider, sessionCode));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
    return c.redirect(redirect(message));
  }
}

oauthRoutes.get('/github/callback', (c) => handleCallback('github', c));
oauthRoutes.get('/discord/callback', (c) => handleCallback('discord', c));

// --- disconnect ---

// Remove the linked OAuth credential and demote the integration badge.
// The integrations row itself stays (it's the user's claimed profile link);
// it just loses the OAuth-backed verified flag.
oauthRoutes.delete('/github/disconnect', requireAuth, async (c) => {
  const userId = requireUserId(c);
  await db
    .delete(oauthAccounts)
    .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, 'github')));
  await db
    .update(integrations)
    .set({ verified: false, updatedAt: new Date() })
    .where(and(eq(integrations.userId, userId), eq(integrations.platform, 'github')));
  return c.json({ ok: true });
});

oauthRoutes.delete('/discord/disconnect', requireAuth, async (c) => {
  const userId = requireUserId(c);
  await db
    .delete(oauthAccounts)
    .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, 'discord')));
  await db
    .update(integrations)
    .set({ verified: false, updatedAt: new Date() })
    .where(and(eq(integrations.userId, userId), eq(integrations.platform, 'discord')));
  return c.json({ ok: true });
});

// --- connect/prepare (iOS linking) ---

// Returns the provider authorization URL without redirecting. iOS calls this
// with a Bearer token (which ASWebAuthenticationSession can't send), gets back
// a URL, then opens it in an ASWebAuthenticationSession. The callback uses the
// counter:// scheme so the session can catch it.
oauthRoutes.post('/:provider/connect/prepare', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const provider = c.req.param('provider') as OAuthProvider;
  if (!PROVIDERS[provider]) throw errors.notFound('Unknown provider');

  const input = await body(c, oauthConnectPrepareSchema);
  const action = input.mobile ? 'mobile_connect' : 'connect';

  const webUrl = c.env.PUBLIC_WEB_URL ?? 'https://counter.ltd';
  const state = await storeOAuthState(provider, action, userId);
  const authUrl = buildAuthUrl(provider, state, callbackUrl(provider, webUrl), c.env);

  return c.json<OAuthConnectPrepareResponse>({ authUrl });
});

// --- session exchange (login flow) ---

// Trade the one-time session code from the login callback for a real JWT pair.
// This is the only way live tokens leave the server — they go directly to the
// client in a POST response body, never through a URL.
oauthRoutes.post('/session/exchange', async (c) => {
  const input = await body(c, sessionExchangeSchema);
  const userId = await consumeSessionCode(input.code);
  const tokens = await issueTokens(userId);
  const user = await getPrivateUser(userId);
  return c.json<AuthResponse>({ ...tokens, user });
});

// --- connected account info ---

// Return the linked account for a provider so the settings page can display
// which handle is connected and offer to disconnect it.
oauthRoutes.get('/:provider/me', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const provider = c.req.param('provider') as OAuthProvider;

  if (!PROVIDERS[provider]) throw errors.notFound('Unknown provider');

  const row = await db.query.oauthAccounts.findFirst({
    where: and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, provider)),
  });

  if (!row) throw errors.notFound('No linked account for this provider');

  // providerEmail is encrypted at rest; decrypt for display. Null stays null.
  const providerEmail = row.providerEmail
    ? await decryptField(row.providerEmail, c.env.MESSAGE_ENCRYPTION_KEY)
    : null;
  return c.json<OAuthConnectedAccount>({
    provider,
    providerUsername: row.providerUsername ?? null,
    providerEmail,
    connectedAt: row.createdAt.toISOString(),
  });
});
