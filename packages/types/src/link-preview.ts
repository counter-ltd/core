// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Shared types for the link preview feature.
 *
 * The preview API proxy fetches OG/meta tags server-side and returns this
 * shape. The web client renders it as a card below the message bubble.
 */

/** OG/meta preview data returned by `GET /preview?url=`. */
export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  /** Absolute URL to the OG image, or null when none was found. */
  image: string | null;
  siteName: string | null;
}
