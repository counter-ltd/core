// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Username and display name content moderation.
 *
 * Keeps slurs out of handles and display names. Normalization strips
 * common leet-speak substitutions before matching so "n1gg3r"-style
 * evasions don't slip through.
 */

// Map characters commonly swapped in to disguise slurs.
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  '$': 's',
  '!': 'i',
  '+': 't',
  '|': 'i',
};

/** Strip leet substitutions and non-alpha chars so "n1gg3r" → "nigger". */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .split('')
    .map((c) => LEET[c] ?? c)
    .join('')
    .replace(/[^a-z]/g, '');
}

/**
 * Slurs blocked in usernames and display names. Listed as plain strings so
 * the list is grep-able and auditable. Matching is substring-based on the
 * normalized form, so plurals and compounds are caught without extra entries.
 */
const BLOCKED_TERMS: readonly string[] = [
  // Racial slurs
  'nigger',
  'nigga',
  'nigg',
  'niga',
  'negger',
  'kike',
  'kyke',
  'chink',
  'gook',
  'spic',
  'spick',
  'wetback',
  'beaner',
  'coon',
  'jigaboo',
  'porch monkey',
  'porchmonkey',
  'raghead',
  'sand nigger',
  'sandnigger',
  'towelhead',
  'zipperhead',
  'slope',
  'cracker',
  'honky',
  'redskin',
  'squaw',
  'halfbreed',
  'mulatto',
  'sambo',
  'darkie',
  'jungle bunny',
  'junglebunny',
  'paki',
  'wog',
  'golliwog',
  'heeb',
  'hymie',
  'yid',
  // Homophobic / transphobic slurs
  'faggot',
  'fagnot',
  'fagot',
  'dyke',
  'tranny',
  'shemale',
  'heshe',
  // Ableist slurs used as insults
  'retard',
  'retarded',
  // Misc hate-speech terms
  'whitepower',
  'white power',
  'heil',
  'sieg heil',
  '1488',
  '14words',
  'kkk',
  'kkkmember',
];

// Pre-normalize the blocklist once at module load so we're not repeating
// work on every validation call.
const NORMALIZED_BLOCKED = BLOCKED_TERMS.map(normalize);

/**
 * Returns true if the string contains a blocked term after normalization.
 *
 * @param s - The username or display name to check (any case, any form).
 */
export function containsBlockedTerm(s: string): boolean {
  const n = normalize(s);
  return NORMALIZED_BLOCKED.some((term) => n.includes(term));
}
