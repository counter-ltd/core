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
import { USER } from '@counter/config';
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

/**
 * Body for `POST /auth/password-reset/request`: ask for a reset link by email.
 *
 * Only an address is needed; the endpoint answers the same way whether or not it
 * matches an account, so the field is all the client ever sends.
 */
export const requestPasswordResetSchema = z.object({
  email: z.string().email(),
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

/**
 * Body for `POST /auth/password-reset/confirm`: redeem a reset token and set a
 * new password. The password bounds match registration so a reset can't slip a
 * weaker password past the rules that signup enforces.
 */
export const confirmPasswordResetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(USER.MIN_PASSWORD_LENGTH).max(USER.MAX_PASSWORD_LENGTH),
});
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>;

/**
 * Body for `POST /admin/users/:id/password-reset`: how the admin wants the reset
 * delivered. `email` mails the user the link; `link` returns the URL in the
 * response for the admin to hand over some other way (useful when the account's
 * address is dead or unreachable).
 */
export const adminPasswordResetSchema = z.object({
  delivery: z.enum(['email', 'link']),
});
export type AdminPasswordResetInput = z.infer<typeof adminPasswordResetSchema>;

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
