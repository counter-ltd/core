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
  'discord',
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

/** Body for `PATCH /integrations/:id`: toggle whether a badge shows on the profile. */
export const patchIntegrationSchema = z.object({
  displayed: z.boolean(),
});
export type PatchIntegrationInput = z.infer<typeof patchIntegrationSchema>;

/** A linked external account as anyone may see it. */
export interface Integration {
  id: string;
  platform: IntegrationPlatform;
  /** The URL that was linked; null for OAuth-connected accounts with no manual URL. */
  url: string | null;
  /** The username on the linked platform, derived from the URL or set by OAuth. */
  username: string | null;
  /** True once a rel="me" link-back or OAuth flow proved control of the account. */
  verified: boolean;
  /** True when the user has chosen to show this badge on their public profile. */
  displayed: boolean;
}

/** The kinds of trust badge a profile can show. Extends as new signals land. */
export type TrustBadgeKind = 'email' | 'link';

/**
 * One badge on a profile. `href` is set when the badge points somewhere (a
 * verified link); `detail` is optional human context (e.g. the username).
 * `platform` lets the client render the right icon for known platforms.
 */
export interface TrustBadge {
  kind: TrustBadgeKind;
  label: string;
  detail?: string;
  href?: string;
  platform?: string;
}
