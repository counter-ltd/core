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
import { USER, PRESENCE, MESSAGING, containsBlockedTerm } from '@counter/config';
import type { PresenceVisibility, MessagingPrivacy, Permission, UserStatus } from '@counter/config';
import type { TrustBadge } from './trust.ts';
import type { GroupSummary } from './admin.ts';

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
  })
  .refine((s) => !containsBlockedTerm(s), {
    message: 'Username contains a term that is not allowed',
  });

/** Body for `POST /auth/register`. */
export const registerSchema = z.object({
  username: usernameSchema,
  email: z.string().email(),
  password: z.string().min(USER.MIN_PASSWORD_LENGTH).max(USER.MAX_PASSWORD_LENGTH),
  displayName: z
    .string()
    .max(USER.MAX_DISPLAY_NAME_LENGTH)
    .refine((s) => !containsBlockedTerm(s), { message: 'Display name contains a term that is not allowed' })
    .optional(),
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
    displayName: z
      .string()
      .max(USER.MAX_DISPLAY_NAME_LENGTH)
      .refine((s) => !containsBlockedTerm(s), { message: 'Display name contains a term that is not allowed' })
      .nullable(),
    bio: z.string().max(USER.MAX_BIO_LENGTH).nullable(),
    // The avatar is set by reference: the client uploads to POST /media and
    // sends the returned object id here, or null to clear it. The server
    // resolves the served URL, so a client can't point an avatar at an arbitrary
    // external image.
    avatarObjectId: z.string().uuid().nullable(),
  })
  .partial();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Presence data visible to a given viewer, subject to the user's visibility
 * settings. Absent from the response when the feature is off or the viewer
 * lacks permission to see it.
 */
export interface UserPresence {
  isOnline: boolean;
  /** ISO 8601 timestamp of the last heartbeat; null when lastSeen is disabled or hidden from this viewer. */
  lastSeenAt: string | null;
}

/** The user's own presence and messaging-privacy configuration, returned only on their private profile. */
export interface PresenceSettings {
  onlineStatusEnabled: boolean;
  onlineStatusVisibility: PresenceVisibility;
  lastSeenEnabled: boolean;
  lastSeenVisibility: PresenceVisibility;
  heartbeatIntervalSeconds: number;
  /** Controls who can start a new conversation with this user. */
  messagingPrivacy: MessagingPrivacy;
  /** When on, this user's typing is shown to whoever they're chatting with. */
  typingIndicatorsEnabled: boolean;
}

/** Partial update body for `PUT /users/me/presence`. All fields are optional. */
export const presenceSettingsSchema = z
  .object({
    onlineStatusEnabled: z.boolean(),
    onlineStatusVisibility: z.enum(PRESENCE.VISIBILITY_OPTIONS),
    lastSeenEnabled: z.boolean(),
    lastSeenVisibility: z.enum(PRESENCE.VISIBILITY_OPTIONS),
    heartbeatIntervalSeconds: z
      .number()
      .int()
      .min(PRESENCE.MIN_HEARTBEAT_INTERVAL)
      .max(PRESENCE.MAX_HEARTBEAT_INTERVAL),
    messagingPrivacy: z.enum(MESSAGING.PRIVACY_OPTIONS),
    typingIndicatorsEnabled: z.boolean(),
  })
  .partial();
export type PresenceSettingsInput = z.infer<typeof presenceSettingsSchema>;

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
    /** Only present on self: whether online status broadcasting is turned on. */
    onlineStatusEnabled?: boolean;
  };
  /**
   * Online status and last-seen, when visible to this viewer. Null means the
   * user has the feature disabled or the viewer doesn't have permission.
   * Absent entirely on feed authors (loaded only on single-profile fetches).
   */
  presence?: UserPresence | null;
}

/** The owner's own view of themselves: PublicUser plus the private fields. */
export interface PrivateUser extends PublicUser {
  email: string; // only ever exposed to the account holder
  /**
   * Whether this account has a password set. False for OAuth-only signups, which
   * lets the settings UI offer "set a password" instead of "change password" and
   * skip asking for a current one that doesn't exist.
   */
  hasPassword: boolean;
  presenceSettings: PresenceSettings;
  /**
   * The groups this account belongs to and the permissions they add up to. Both
   * are the account holder's own, returned so a client can decide whether to show
   * the admin panel and which controls inside it to enable. `permissions` is the
   * union across `groups`; a normal user gets two empty arrays.
   */
  groups: GroupSummary[];
  permissions: Permission[];
  /** Moderation state. Always 'active' for anyone who can reach this endpoint. */
  status: UserStatus;
}
