import { z } from 'zod';
import { USER } from '@counter/config';

export const usernameSchema = z
  .string()
  .min(USER.MIN_USERNAME_LENGTH)
  .max(USER.MAX_USERNAME_LENGTH)
  .transform((s) => s.toLowerCase())
  .refine((s) => USER.USERNAME_PATTERN.test(s), {
    message: 'Username may contain only lowercase letters, digits and underscores',
  });

export const registerSchema = z.object({
  username: usernameSchema,
  email: z.string().email(),
  password: z.string().min(USER.MIN_PASSWORD_LENGTH).max(USER.MAX_PASSWORD_LENGTH),
  displayName: z.string().max(USER.MAX_DISPLAY_NAME_LENGTH).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  // Accept either username or email in one field.
  identifier: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z
  .object({
    displayName: z.string().max(USER.MAX_DISPLAY_NAME_LENGTH).nullable(),
    bio: z.string().max(USER.MAX_BIO_LENGTH).nullable(),
    avatarUrl: z.string().url().nullable(),
  })
  .partial();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Public projection of a user. Never includes email or password_hash. */
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
  /** Present only when the request is authenticated. */
  viewer?: {
    isFollowing: boolean;
    isSelf: boolean;
  };
}

/** Own profile — adds private fields the user is allowed to see about themselves. */
export interface PrivateUser extends PublicUser {
  email: string;
}
