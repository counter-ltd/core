// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Request and response shapes for the login lifecycle: refreshing a session and
 * logging out, plus what a successful auth call hands back.
 *
 * The actual token signing lives in the API (see lib/jwt.ts). This file is just
 * the contract the web app and API agree on for those endpoints.
 */
import { z } from 'zod';
import type { PrivateUser } from './user.ts';

/** Body for `POST /auth/refresh`: trade a refresh token for a fresh token pair. */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

/**
 * Body for `POST /auth/logout`. The token is optional and the whole body
 * defaults to `{}`, so a client can log out the current session without
 * sending anything. Passing a token lets it revoke that specific session.
 */
export const logoutSchema = z
  .object({
    refreshToken: z.string().min(1).optional(),
  })
  .optional()
  .default({});

/** Body for `POST /auth/verify`: redeem an email-verification token. */
export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

/** The two tokens minted on login, plus when the access token expires. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds, so the client can refresh before it dies. */
  expiresIn: number;
}

/** What login and register return: the token pair plus the signed-in user. */
export interface AuthResponse extends TokenPair {
  user: PrivateUser;
}
