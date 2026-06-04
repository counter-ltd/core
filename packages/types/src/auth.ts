import { z } from 'zod';
import type { PrivateUser } from './user.ts';

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z
  .object({
    refreshToken: z.string().min(1).optional(),
  })
  .optional()
  .default({});

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds, for client-side scheduling. */
  expiresIn: number;
}

export interface AuthResponse extends TokenPair {
  user: PrivateUser;
}
