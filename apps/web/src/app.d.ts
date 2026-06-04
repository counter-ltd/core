import type { PrivateUser } from '@counter/types';

declare global {
  namespace App {
    interface Locals {
      /** The signed-in user, resolved from cookies in hooks. Null when anonymous. */
      user: PrivateUser | null;
      /** Current access token, possibly refreshed during the request. */
      accessToken: string | null;
    }
    interface PageData {
      user?: PrivateUser | null;
    }
    // interface Error {}
    // interface Platform {}
  }
}

export {};
