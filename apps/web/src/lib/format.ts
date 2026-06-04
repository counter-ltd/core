/** Compact relative time, e.g. "now", "5m", "3h", "2d", or a date. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, (Date.now() - then) / 1000);
  if (secs < 45) return 'now';
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  if (secs < 604800) return `${Math.round(secs / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** 1.2k / 3.4M style compact counts. */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/**
 * Turn @mentions and #hashtags in a post body into links. Escapes HTML first so
 * raw bodies can never inject markup.
 */
export function linkify(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped
    .replace(/(^|\s)#([\p{L}\p{N}_]+)/gu, '$1<a class="tag" href="/tags/$2">#$2</a>')
    .replace(/(^|\s)@([a-z0-9_]+)/gi, '$1<a class="mention" href="/$2">@$2</a>')
    .replace(/\n/g, '<br>');
}
