// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Ambient type declarations SvelteKit merges into its own `App` namespace.
 *
 * `Locals` is what the server `handle` hook fills in per request and routes
 * read back; `PageData` is the shape shared across pages via the root layout's
 * load. Editing these tells the whole app what `event.locals` and `$page.data`
 * are guaranteed to hold.
 */
import type { PrivateUser } from '@counter/types';

declare global {
  namespace App {
    interface Locals {
      /** The signed-in user, resolved from cookies in hooks. Null when anonymous. */
      user: PrivateUser | null;
      /** Current access token, possibly refreshed during the request. */
      accessToken: string | null;
      /**
       * All stored accounts without their refresh tokens, safe to pass to the
       * browser via the root layout. First entry matches `user` when signed in.
       */
      accounts: Array<{
        userId: string;
        username: string;
        displayName: string | null;
        avatarUrl: string | null;
      }>;
    }
    interface PageData {
      user?: PrivateUser | null;
      accounts?: Array<{
        userId: string;
        username: string;
        displayName: string | null;
        avatarUrl: string | null;
      }>;
    }
    // interface Error {}
    // interface Platform {}
  }
}

export {};
