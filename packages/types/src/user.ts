// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * User accounts: the register/login/profile write schemas, plus the public and
 * private read projections.
 *
 * The split between PublicUser and PrivateUser is the privacy boundary for this
 * type. Anything anyone can see lives on PublicUser; fields only the owner may
 * see (their email) are added by PrivateUser.
 */
import { z } from 'zod';
import { USER } from '@counter/config';
import type { TrustBadge } from './trust.ts';

// Usernames are lowercased before the pattern check, so the stored form is
// canonical and lookups stay case-insensitive. The transform runs first, then
// the refine validates the already-lowercased value.
export const usernameSchema = z
  .string()
  .min(USER.MIN_USERNAME_LENGTH)
  .max(USER.MAX_USERNAME_LENGTH)
  .transform((s) => s.toLowerCase())
  .refine((s) => USER.USERNAME_PATTERN.test(s), {
    message: 'Username may contain only lowercase letters, digits and underscores',
  });

/** Body for `POST /auth/register`. */
export const registerSchema = z.object({
  username: usernameSchema,
  email: z.string().email(),
  password: z.string().min(USER.MIN_PASSWORD_LENGTH).max(USER.MAX_PASSWORD_LENGTH),
  displayName: z.string().max(USER.MAX_DISPLAY_NAME_LENGTH).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/** Body for `POST /auth/login`. */
export const loginSchema = z.object({
  // One field accepts either a username or an email; the API figures out which.
  identifier: z.string().min(1),
  password: z.string().min(1), // only presence is checked here; correctness is verified server-side
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Body for editing a profile. `.partial()` makes every field optional so a
 * client can patch just one. The fields stay nullable so a value can be cleared
 * (set to null) rather than only changed, which a plain optional couldn't express.
 */
export const updateProfileSchema = z
  .object({
    displayName: z.string().max(USER.MAX_DISPLAY_NAME_LENGTH).nullable(),
    bio: z.string().max(USER.MAX_BIO_LENGTH).nullable(),
    avatarUrl: z.string().url().nullable(),
  })
  .partial();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** A user as anyone may see them. Deliberately omits email and password hash. */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  verified: boolean;
  createdAt: string;
  counts: {
    posts: number;
    followers: number;
    following: number;
  };
  /**
   * Verified trust badges. Only attached on a single-profile fetch (not on post
   * authors in a feed), so it's optional; absent means "not loaded here", not
   * "none". Display only, never gates anything.
   */
  signals?: TrustBadge[];
  /** This viewer's relationship to the user. Present only when authenticated. */
  viewer?: {
    isFollowing: boolean;
    isSelf: boolean; // true when looking at your own profile
  };
}

/** The owner's own view of themselves: PublicUser plus the private fields. */
export interface PrivateUser extends PublicUser {
  email: string; // only ever exposed to the account holder
}
