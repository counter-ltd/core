// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Turning a user's verified facts into the trust badges a profile shows.
 *
 * Badges are computed, not stored: each one reflects current state (a verified
 * email, a verified link) so there's no separate score to keep in sync and
 * nothing to game. They're display only and never feed ranking, by design, see
 * @counter/types `trust.ts` and the CSL's ban on hidden ranking signals.
 */
import { db, integrations, eq, and } from '@counter/db';
import type { Integration, TrustBadge } from '@counter/types';

// How each platform is labelled on a badge. Falls back to the raw key for a
// platform we haven't given a pretty name yet.
const PLATFORM_LABELS: Record<string, string> = {
  website: 'Website',
  github: 'GitHub',
  bandcamp: 'Bandcamp',
  soundcloud: 'SoundCloud',
  letterboxd: 'Letterboxd',
  goodreads: 'Goodreads',
  strava: 'Strava',
  itch: 'itch.io',
};

/** Project an integration row into the public shape. */
export function serializeIntegration(row: {
  id: string;
  platform: string;
  platformUrl: string | null;
  verified: boolean;
}): Integration {
  return {
    id: row.id,
    platform: row.platform as Integration['platform'],
    url: row.platformUrl,
    verified: row.verified,
  };
}

/**
 * Build the badge list for one user.
 *
 * @param userId         Whose badges to compute.
 * @param emailVerified  The user's `verified` flag, passed in so we don't re-read
 *                       a row the caller already has.
 * @returns              Verified-email badge (if any) followed by one badge per
 *                       verified linked account.
 */
export async function getTrustBadges(userId: string, emailVerified: boolean): Promise<TrustBadge[]> {
  const badges: TrustBadge[] = [];
  if (emailVerified) badges.push({ kind: 'email', label: 'Verified email' });

  const links = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.verified, true)));
  for (const l of links) {
    badges.push({
      kind: 'link',
      label: PLATFORM_LABELS[l.platform] ?? l.platform,
      detail: l.platformUsername,
      href: l.platformUrl ?? undefined,
    });
  }
  return badges;
}
