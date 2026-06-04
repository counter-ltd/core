// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The public changelog page.
 *
 * Source of truth is the CHANGELOG.md in the docs repo, not this app. We fetch
 * the raw Markdown at request time and parse it into structured releases so the
 * page can render them, which keeps the changelog in one place and out of code.
 */
import type { PageServerLoad } from './$types';

// Pulled straight from the docs repo's main branch so the page always reflects
// what's been merged there, no redeploy of this app required.
const RAW_URL =
  'https://raw.githubusercontent.com/counter-ltd/documents/main/CHANGELOG.md';

export type Category = { name: string; items: string[] };
export type Release = { version: string; date: string | null; categories: Category[] };

/**
 * Turn Keep-a-Changelog style Markdown into structured releases.
 *
 * The expected shape: `## [version] - date` headings split releases, `### name`
 * headings group items within a release, and `-`/`*` bullets are the items.
 *
 * @param md  Raw CHANGELOG.md text.
 * @returns   One entry per release heading, newest first as written in the file.
 */
function parse(md: string): Release[] {
  const releases: Release[] = [];
  // Split on the `##` release headings. The first chunk is the file's preamble
  // (title, intro) which sits before any heading, so drop it.
  const sections = md.split(/^## /m).slice(1);

  for (const section of sections) {
    const lines = section.split('\n');
    const header = lines[0].trim();
    // Pull the version out of `[version]` and the optional trailing `- date`.
    const m = header.match(/^\[(.+?)\](?:\s*-\s*(\S+))?/);
    // A heading that doesn't match the pattern (stray `##`) isn't a release;
    // skip it rather than pushing a half-formed entry.
    if (!m) continue;

    const version = m[1];
    const date = m[2] ?? null;
    const categories: Category[] = [];
    // Tracks the category we're currently filling so bullets land under the
    // most recent `###` heading we passed.
    let current: Category | null = null;

    for (const line of lines.slice(1)) {
      if (line.startsWith('### ')) {
        current = { name: line.slice(4).trim(), items: [] };
        categories.push(current);
      } else if (/^[-*] /.test(line) && current) {
        // Only attach bullets once we've seen a category heading; loose
        // bullets before the first `###` have nowhere to go and are ignored.
        current.items.push(line.slice(2).trim());
      }
    }

    releases.push({ version, date, categories });
  }

  return releases;
}

export const load: PageServerLoad = async ({ fetch }) => {
  // The fetch reaches an external host, so anything (network, 404, bad body)
  // can go wrong. Every failure path returns the same empty-list-plus-error
  // shape so the page can render a friendly notice instead of crashing.
  try {
    const res = await fetch(RAW_URL);
    if (!res.ok) return { releases: [], error: 'Could not load changelog.' };
    const text = await res.text();
    return { releases: parse(text), error: null };
  } catch {
    return { releases: [], error: 'Could not load changelog.' };
  }
};
