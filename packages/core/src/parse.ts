import type { Cue } from './types.js';
import { parseTimestampToMs } from './format.js';

function normalizeText(text: string): string {
  // Strip a leading UTF-8 BOM and normalize CRLF/CR to LF.
  return text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripMarkup(raw: string): string {
  let s = raw;
  // ASS/SSA-style override tags that sometimes leak into SRT, e.g. {\an8}
  s = s.replace(/\{\\[^{}]*\}/g, '');
  // HTML-ish tags: <i>, </i>, <b>, <u>, <font color="...">, <c.magenta>, <v Speaker> ...
  s = s.replace(/<[^>]*>/g, '');
  return s;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function splitTimingLine(line: string): { startRaw: string; endRaw: string } | null {
  const arrowIndex = line.indexOf('-->');
  if (arrowIndex === -1) return null;
  const startRaw = line.slice(0, arrowIndex).trim();
  const rest = line.slice(arrowIndex + 3).trim();
  // Everything after the end timestamp on the same line is "cue settings"
  // (VTT: align:start position:10% / SRT: rarely present) — discard it.
  const endRaw = rest.split(/\s+/)[0] ?? '';
  return { startRaw, endRaw };
}

/**
 * Parses SubRip (.srt) text into cues. Tolerates a missing UTF-8 BOM or
 * CRLF line endings, missing/garbled cue index numbers, HTML-ish markup
 * (`<i>`, `<b>`, `<font>`) and `{\an8}`-style override tags (all stripped),
 * and multi-line cue text (joined with a single space).
 */
export function parseSrt(text: string): Cue[] {
  const normalized = normalizeText(text);
  const blocks = normalized.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 0);
  const cues: Cue[] = [];
  let autoIndex = 0;

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    let lineOffset = 0;
    // Optional numeric index line, e.g. "42". Only treat it as an index if
    // the following line actually looks like a timing line, so we don't
    // accidentally swallow a cue whose text happens to start with a number.
    if (/^\d+$/.test(lines[0] ?? '') && lines.length > 1 && (lines[1] ?? '').includes('-->')) {
      lineOffset = 1;
    }

    const timingLine = lines[lineOffset];
    if (!timingLine) continue;
    const timing = splitTimingLine(timingLine);
    if (!timing) continue; // not a cue block (stray text) — skip

    const startMs = parseTimestampToMs(timing.startRaw);
    const endMs = parseTimestampToMs(timing.endRaw);
    if (startMs === null || endMs === null) continue;

    const textLines = lines.slice(lineOffset + 1);
    const text = collapseWhitespace(stripMarkup(textLines.join(' ')));
    if (!text) continue;

    autoIndex += 1;
    cues.push({ index: autoIndex, startMs, endMs, text });
  }

  return cues;
}

const VTT_BLOCK_KEYWORDS = ['WEBVTT', 'NOTE', 'STYLE', 'REGION'];

/**
 * Parses WebVTT (.vtt) text into cues. Tolerates the `WEBVTT` header (with
 * or without trailing metadata), `NOTE`/`STYLE`/`REGION` blocks, cue
 * identifiers, cue settings (`align:start position:10%` etc.), timestamps
 * with the hour component omitted (`mm:ss.mmm`), and inline tags like
 * `<b>`, `<c.magenta>`, `<v Speaker>` (all stripped).
 */
export function parseVtt(text: string): Cue[] {
  const normalized = normalizeText(text);
  const blocks = normalized.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 0);
  const cues: Cue[] = [];
  let autoIndex = 0;

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    const firstWord = (lines[0] ?? '').split(/\s+/)[0] ?? '';
    if (VTT_BLOCK_KEYWORDS.includes(firstWord)) continue;

    let lineOffset = 0;
    if (!(lines[0] ?? '').includes('-->')) {
      // Optional cue identifier line.
      lineOffset = 1;
    }

    const timingLine = lines[lineOffset];
    if (!timingLine || !timingLine.includes('-->')) continue;
    const timing = splitTimingLine(timingLine);
    if (!timing) continue;

    const startMs = parseTimestampToMs(timing.startRaw);
    const endMs = parseTimestampToMs(timing.endRaw);
    if (startMs === null || endMs === null) continue;

    const textLines = lines.slice(lineOffset + 1);
    const text = collapseWhitespace(stripMarkup(textLines.join(' ')));
    if (!text) continue;

    autoIndex += 1;
    cues.push({ index: autoIndex, startMs, endMs, text });
  }

  return cues;
}

/**
 * Parses subtitle text, auto-detecting SRT vs WebVTT from content when
 * `format` is not given (a `WEBVTT` header signals VTT; otherwise SRT).
 */
export function parseSubtitles(text: string, format?: 'srt' | 'vtt'): Cue[] {
  if (format === 'srt') return parseSrt(text);
  if (format === 'vtt') return parseVtt(text);
  const trimmed = text.replace(/^﻿/, '').trimStart();
  if (/^WEBVTT/.test(trimmed)) return parseVtt(text);
  return parseSrt(text);
}
