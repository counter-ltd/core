// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Shared types and schemas for OAuth platform integrations.
 *
 * These cover the two OAuth actions (connecting a platform, logging in via one)
 * and the data exposed about a connected account. Token storage and provider
 * API calls live in the API's lib/oauth.ts; this file is just the contract.
 */
import { z } from 'zod';

/** The OAuth providers Counter supports. */
export type OAuthProvider = 'github' | 'discord';

/**
 * Body for `POST /auth/:provider/connect/prepare`.
 *
 * iOS passes `mobile: true` so the callback redirects to the `counter://`
 * custom scheme that ASWebAuthenticationSession can intercept. Web omits it
 * (or sends false) and gets the normal web redirect.
 */
export const oauthConnectPrepareSchema = z.object({
  mobile: z.boolean().default(false),
});
export type OAuthConnectPrepareInput = z.infer<typeof oauthConnectPrepareSchema>;

/** Response from `POST /auth/:provider/connect/prepare`. */
export interface OAuthConnectPrepareResponse {
  /** The provider's authorization URL to open in a browser or ASWebAuthenticationSession. */
  authUrl: string;
}

/**
 * Body for `POST /auth/session/exchange`.
 *
 * Trades the short-lived opaque code issued after an OAuth login callback for
 * a real JWT pair. The code is single-use and expires in five minutes.
 */
export const sessionExchangeSchema = z.object({
  code: z.string().min(1),
});
export type SessionExchangeInput = z.infer<typeof sessionExchangeSchema>;

/**
 * What `GET /auth/:provider/me` returns for a connected account.
 *
 * Enough to display in the settings UI (which handle, which email, when it was
 * linked) without exposing the stored credential.
 */
export interface OAuthConnectedAccount {
  provider: OAuthProvider;
  providerUsername: string | null;
  providerEmail: string | null;
  /** ISO 8601 string of when this account was connected. */
  connectedAt: string;
}
