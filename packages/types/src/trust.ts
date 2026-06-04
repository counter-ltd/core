// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Trust signals: the verifiable badges a profile can carry.
 *
 * The model is deliberately a list of discrete, explainable badges rather than
 * a single score. Each badge states one fact the user opted into and verified.
 * They are display only, they never gate a feature and never touch ranking,
 * which keeps them clear of the CSL's bans on engagement gates and hidden
 * ranking signals. See documents/LICENSE.md Part III.
 */
import { z } from 'zod';

/**
 * The external platforms a user can link and verify. `website` is the generic
 * "my own domain" case, the others are named services. Linking proves nothing
 * on its own; a link becomes a badge only once verified via rel="me".
 */
export const INTEGRATION_PLATFORMS = [
  'website',
  'github',
  'bandcamp',
  'soundcloud',
  'letterboxd',
  'goodreads',
  'strava',
  'itch',
] as const;
export type IntegrationPlatform = (typeof INTEGRATION_PLATFORMS)[number];

/** Body for `POST /integrations`: link an external profile to verify later. */
export const addIntegrationSchema = z.object({
  platform: z.enum(INTEGRATION_PLATFORMS),
  // The page we'll fetch and check for a rel="me" link back to this account.
  url: z.string().url(),
});
export type AddIntegrationInput = z.infer<typeof addIntegrationSchema>;

/** A linked external account as anyone may see it. */
export interface Integration {
  id: string;
  platform: IntegrationPlatform;
  url: string | null;
  /** True once a rel="me" link-back proved the user controls the linked page. */
  verified: boolean;
}

/** The kinds of trust badge a profile can show. Extends as new signals land. */
export type TrustBadgeKind = 'email' | 'link';

/**
 * One badge on a profile. `href` is set when the badge points somewhere (a
 * verified link); `detail` is optional human context (e.g. the platform name).
 */
export interface TrustBadge {
  kind: TrustBadgeKind;
  label: string;
  detail?: string;
  href?: string;
}
