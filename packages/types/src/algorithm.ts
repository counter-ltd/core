// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Shapes for the feed-ranking algorithm we publish openly.
 *
 * Counter shows everyone exactly how the feed is ranked: the live weights and
 * parameters, plus a changelog of every tweak. These types describe what
 * `GET /algorithm` hands back so the web app can render that transparency page.
 */

/**
 * The ranking algorithm as it stands right now. Mirrors the server-side
 * ALGORITHM constant and is served as-is from `GET /algorithm`.
 */
export interface AlgorithmState {
  version: string;
  description: string;
  weights: Record<string, number>; // signal name -> how heavily it counts
  parameters: Record<string, number | boolean>; // tuning knobs (e.g. decay rate, flags)
}

/** One entry in the public history of changes to the ranking algorithm. */
export interface AlgorithmChangelogEntry {
  id: string;
  version: string;
  summary: string;
  detail: string | null; // longer write-up; null when the summary says it all
  changedBy: string; // username of whoever shipped the change
  commitHash: string; // ties the change back to the exact code that deployed it
  deployedAt: string;
}
