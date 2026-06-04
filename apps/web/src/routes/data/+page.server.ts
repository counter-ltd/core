// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The public data-collection disclosure.
 *
 * The CSL (Condition 4) requires a complete, current, publicly readable account
 * of every category of data we collect, why, and how long we keep it. Rather
 * than maintain a second copy that could drift, we fetch the same DATA-MODEL.md
 * that lives in the docs repo and parse it into blocks the page can render. One
 * source of truth, surfaced in the app so a User never has to go digging.
 */
import type { PageServerLoad } from './$types';

// Same docs repo and branch the changelog reads from, so the disclosure the app
// shows is always whatever's been merged there, no redeploy needed.
const RAW_URL =
  'https://raw.githubusercontent.com/counter-ltd/documents/main/DATA-MODEL.md';

/** A run of inline text, optionally `code` or **bold**. */
export type Run = { t: string; code?: boolean; strong?: boolean };

/** One rendered block within a section. Tables and lists carry inline runs. */
export type Block =
  | { type: 'p'; runs: Run[] }
  | { type: 'code'; code: string }
  | { type: 'table'; head: Run[][]; rows: Run[][][] }
  | { type: 'list'; items: Run[][] };

/** A `##` section: its heading plus the blocks under it. */
export type Section = { title: string; blocks: Block[] };

/**
 * Split a line into inline runs, pulling out `code` spans and **bold** spans.
 * Everything else stays plain text. Kept deliberately small: it only needs to
 * cover the inline markdown DATA-MODEL.md actually uses.
 */
function inline(text: string): Run[] {
  const runs: Run[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ t: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith('`')) runs.push({ t: tok.slice(1, -1), code: true });
    else runs.push({ t: tok.slice(2, -2), strong: true });
    last = m.index + tok.length;
  }
  if (last < text.length) runs.push({ t: text.slice(last) });
  return runs;
}

/** Split a `| a | b |` table row into trimmed cells, dropping the edge pipes. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

/**
 * Parse the DATA-MODEL markdown into a title, an intro, and `##` sections.
 *
 * The grammar is small on purpose. We walk lines once, handling fenced code,
 * pipe tables, and `-` lists as multi-line blocks (look-ahead inside the loop)
 * and treating everything else as paragraphs. `---` rules are skipped since the
 * section panels already provide the visual breaks.
 */
function parse(md: string): { title: string; intro: Block[]; sections: Section[] } {
  const lines = md.split('\n');
  let title = 'Data';
  const intro: Block[] = [];
  const sections: Section[] = [];

  // Where new blocks land: the intro until the first `##`, then the open
  // section. A running paragraph buffer is flushed on any block boundary.
  let target = intro;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      target.push({ type: 'p', runs: inline(para.join(' ')) });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flushPara();
      // Collect everything up to the closing fence; drop the ```lang markers.
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
      target.push({ type: 'code', code: body.join('\n') });
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushPara();
      const section: Section = { title: trimmed.slice(3).trim(), blocks: [] };
      sections.push(section);
      target = section.blocks;
      continue;
    }

    if (trimmed.startsWith('# ')) {
      flushPara();
      title = trimmed.slice(2).trim();
      continue;
    }

    if (trimmed.startsWith('|')) {
      flushPara();
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      i--; // step back; the for-loop will advance past the last table line
      const head = cells(rows[0]).map(inline);
      // rows[1] is the `|---|---|` separator, so the body starts at row 2.
      const body = rows.slice(2).map((r) => cells(r).map(inline));
      target.push({ type: 'table', head, rows: body });
      continue;
    }

    if (/^[-*] /.test(trimmed)) {
      flushPara();
      const items: Run[][] = [];
      while (i < lines.length && /^[-*] /.test(lines[i].trim())) {
        items.push(inline(lines[i].trim().slice(2)));
        i++;
      }
      i--;
      target.push({ type: 'list', items });
      continue;
    }

    if (trimmed === '---' || trimmed === '') {
      flushPara();
      continue;
    }

    para.push(trimmed);
  }
  flushPara();

  return { title, intro, sections };
}

export const load: PageServerLoad = async ({ fetch }) => {
  // The fetch hits an external host, so treat every failure the same: hand the
  // page an empty doc plus an error flag so it shows a notice, not a stack trace.
  try {
    const res = await fetch(RAW_URL);
    if (!res.ok) return { doc: null, error: 'Could not load the data disclosure.' };
    const text = await res.text();
    return { doc: parse(text), error: null };
  } catch {
    return { doc: null, error: 'Could not load the data disclosure.' };
  }
};
