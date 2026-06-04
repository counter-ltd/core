// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Turn human-friendly duration config into seconds.
 *
 * Lets settings like token TTLs read as "15m" or "30d" instead of raw second
 * counts nobody can sanity-check at a glance. The supported units are s/m/h/d/w.
 *
 * @param input  A "<number><unit>" string, or a bare number already in seconds.
 * @returns      The duration in seconds.
 * @throws       If the string is neither a known unit form nor a plain number.
 */
export function parseDuration(input: string): number {
  const match = /^(\d+)\s*([smhdw])$/.exec(input.trim());
  if (!match) {
    // Fall back to treating a bare numeric string as a second count, so a value
    // that's already in seconds passes through untouched.
    const asNumber = Number(input);
    if (Number.isFinite(asNumber)) return asNumber;
    throw new Error(`Invalid duration: ${input}`);
  }
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd' | 'w';
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 } as const;
  return value * multipliers[unit];
}
