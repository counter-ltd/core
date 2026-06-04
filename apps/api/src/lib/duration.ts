/** Parse durations like "15m", "30d", "12h", "45s", "2w" into seconds. */
export function parseDuration(input: string): number {
  const match = /^(\d+)\s*([smhdw])$/.exec(input.trim());
  if (!match) {
    const asNumber = Number(input);
    if (Number.isFinite(asNumber)) return asNumber;
    throw new Error(`Invalid duration: ${input}`);
  }
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd' | 'w';
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 } as const;
  return value * multipliers[unit];
}
