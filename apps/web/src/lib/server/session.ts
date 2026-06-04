// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Multi-account session storage: two httpOnly cookies, never readable by JS.
 *
 * `counter_access` holds the active account's short-lived access token (1 h).
 * `counter_accounts` holds a JSON array of every signed-in account ordered so
 * the first entry is always the active one. Refresh tokens live inside that
 * array, keeping them server-only even though the cookie travels from the
 * browser on every request.
 *
 * Switching accounts reorders the array and clears the access cookie; the
 * hooks middleware transparently refreshes the new active account's token on
 * the very next request. Logging out removes the first entry; if another
 * account remains, the hooks layer picks it up automatically.
 */
import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { TokenPair } from '@counter/types';

export const ACCESS_COOKIE = 'counter_access';
export const ACCOUNTS_COOKIE = 'counter_accounts';

/** A signed-in account as stored in the accounts cookie — server-only. */
export type StoredAccount = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** Never exposed to the browser; lives only inside the httpOnly cookie. */
  refreshToken: string;
};

/**
 * The refresh-token-free projection safe to put on `locals` and pass to the
 * browser via the root layout. Shape matches what Avatar needs.
 */
export type SafeAccount = Omit<StoredAccount, 'refreshToken'>;

// Shared attributes for both session cookies. `sameSite: 'lax'` is the CSRF
// backstop — blocks the cookies on cross-site POSTs while still sending them
// on top-level navigations. `httpOnly` keeps them out of JS entirely.
const base = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: !dev,
};

function parseAccounts(cookies: Cookies): StoredAccount[] {
  try {
    const raw = cookies.get(ACCOUNTS_COOKIE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAccounts(cookies: Cookies, accounts: StoredAccount[]): void {
  if (accounts.length === 0) {
    cookies.delete(ACCOUNTS_COOKIE, { path: '/' });
    return;
  }
  cookies.set(ACCOUNTS_COOKIE, JSON.stringify(accounts), {
    ...base,
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** All stored accounts; first entry is the active one. */
export function getStoredAccounts(cookies: Cookies): StoredAccount[] {
  return parseAccounts(cookies);
}

/** The active (first) account, or null when nobody is signed in. */
export function getActiveAccount(cookies: Cookies): StoredAccount | null {
  return parseAccounts(cookies)[0] ?? null;
}

/** Read the access token and the active account's refresh token. */
export function readTokens(cookies: Cookies): {
  accessToken: string | null;
  refreshToken: string | null;
} {
  return {
    accessToken: cookies.get(ACCESS_COOKIE) ?? null,
    refreshToken: getActiveAccount(cookies)?.refreshToken ?? null,
  };
}

/**
 * Add or update an account, making it the active one.
 *
 * If the account is already in the list (same userId), the existing entry is
 * replaced and moved to the front. Called after login and register.
 */
export function setActiveAccount(
  cookies: Cookies,
  tokens: TokenPair,
  user: { id: string; username: string; displayName: string | null; avatarUrl: string | null },
): void {
  const accounts = parseAccounts(cookies);
  const rest = accounts.filter((a) => a.userId !== user.id);
  const entry: StoredAccount = {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    refreshToken: tokens.refreshToken,
  };
  writeAccounts(cookies, [entry, ...rest]);
  cookies.set(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: 60 * 60 });
}

/**
 * Update the active account's token pair after a rotation.
 *
 * Called by the hooks middleware each time a transparent access-token refresh
 * succeeds. Keeps the stored refresh token in sync with the API session.
 */
export function updateActiveTokens(cookies: Cookies, tokens: TokenPair): void {
  const accounts = parseAccounts(cookies);
  if (accounts.length === 0) return;
  const [active, ...rest] = accounts;
  writeAccounts(cookies, [{ ...active, refreshToken: tokens.refreshToken }, ...rest]);
  cookies.set(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: 60 * 60 });
}

/**
 * Reorder the accounts list so `userId` is first, then clear the access
 * cookie. The hooks middleware will exchange the new active account's refresh
 * token for a fresh access token on the very next request.
 *
 * Returns the new active account, or null when `userId` isn't in the list.
 */
export function switchToAccount(cookies: Cookies, userId: string): StoredAccount | null {
  const accounts = parseAccounts(cookies);
  const idx = accounts.findIndex((a) => a.userId === userId);
  if (idx < 0) return null;
  const reordered = [accounts[idx], ...accounts.slice(0, idx), ...accounts.slice(idx + 1)];
  writeAccounts(cookies, reordered);
  // Drop the old access token so the hooks layer is forced to refresh it for
  // the new active account rather than using the previous account's token.
  cookies.delete(ACCESS_COOKIE, { path: '/' });
  return reordered[0];
}

/**
 * Remove an account from the list.
 *
 * When the removed account was the active one, the next account in the list
 * automatically becomes active (hooks will refresh it on the next request).
 * Returns the new active account, or null when the list is now empty.
 */
export function removeAccount(cookies: Cookies, userId: string): StoredAccount | null {
  const accounts = parseAccounts(cookies);
  const remaining = accounts.filter((a) => a.userId !== userId);
  writeAccounts(cookies, remaining);
  if (remaining.length === 0) {
    cookies.delete(ACCESS_COOKIE, { path: '/' });
    return null;
  }
  return remaining[0];
}

/** Remove every account and the access token. Full sign-out. */
export function clearAllAccounts(cookies: Cookies): void {
  cookies.delete(ACCOUNTS_COOKIE, { path: '/' });
  cookies.delete(ACCESS_COOKIE, { path: '/' });
}
