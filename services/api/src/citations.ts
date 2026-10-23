import type { Cue, SpoilerSafeContext } from '@contextcue/core';
import type { CitationCue } from './types.js';
import { buildCuesByIndex, expandToSentenceSpan } from './sentence-span.js';

/** Parse a "[mm:ss]" or "[h:mm:ss]" timestamp string into milliseconds. Returns null if invalid. */
function parseTimestampToMs(raw: string): number | null {
  const parts = raw.split(':').map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 2) {
    const [mm, ss] = parts;
    return (mm * 60 + ss) * 1000;
  }
  if (parts.length === 3) {
    const [hh, mm, ss] = parts;
    return ((hh * 60 + mm) * 60 + ss) * 1000;
  }
  return null;
}

const TIMESTAMP_RE = /\[(\d{1,2}(?::\d{2}){1,2})\]/g;

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9']+/g) ?? []);
}

/** True if the cue time ranges intersect, or >50% of the smaller text's words are shared. */
export function spansOverlap(a: CitationCue, b: CitationCue): boolean {
  if (a.startMs < b.endMs && b.startMs < a.endMs) return true;
  const wa = wordSet(a.text);
  const wb = wordSet(b.text);
  const smaller = Math.min(wa.size, wb.size);
  if (smaller === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / smaller > 0.5;
}

/**
 * Derive citations for an answer:
 * - parse [mm:ss] (or [h:mm:ss]) timestamps the model cited, map each to the nearest cue
 *   at or before that timestamp
 * - if none cited, fall back to the top retrieved cues, else the most recent cues
 * - HARD SAFETY NET: never return a cue with startMs > safeMs, regardless of source
 */
export function buildCitations(
  answer: string,
  context: SpoilerSafeContext,
  safeMs: number,
  maxCitations = 3
): CitationCue[] {
  const pool: Cue[] = [...context.recent, ...context.retrieved]
    .filter((c) => c.startMs <= safeMs)
    .sort((a, b) => a.startMs - b.startMs);

  if (pool.length === 0) return [];

  // Looked up by cue index (not array position) when expanding a base cue into a
  // fuller sentence-ish span — built from EVERY cue the context carries, safe or
  // not, because `expandToSentenceSpan` re-checks the `startMs <= safeMs` hard
  // ceiling itself at each step rather than trusting this map's contents.
  const cuesByIndex = buildCuesByIndex(context.recent, context.retrieved);

  const citedMs = new Set<number>();
  let match: RegExpExecArray | null;
  TIMESTAMP_RE.lastIndex = 0;
  while ((match = TIMESTAMP_RE.exec(answer))) {
    const ms = parseTimestampToMs(match[1]);
    if (ms != null) citedMs.add(ms);
  }

  const citations: CitationCue[] = [];

  if (citedMs.size > 0) {
    for (const ms of citedMs) {
      let best: Cue | undefined;
      let bestDist = Infinity;
      for (const c of pool) {
        const dist = Math.abs(c.startMs - ms);
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      if (best) {
        const span = expandToSentenceSpan(best, cuesByIndex, safeMs);
        citations.push(span);
      }
    }
  }

  if (citations.length === 0) {
    const source = context.retrieved.length > 0 ? context.retrieved : context.recent;
    const picked = source.filter((c) => c.startMs <= safeMs).slice(-maxCitations);
    for (const c of picked) {
      const span = expandToSentenceSpan(c, cuesByIndex, safeMs);
      citations.push(span);
    }
  }

  // De-dupe by startMs, keep chronological order, enforce the safety net once more.
  const seen = new Set<number>();
  const deduped: CitationCue[] = [];
  for (const c of citations.sort((a, b) => a.startMs - b.startMs)) {
    if (c.startMs > safeMs) continue; // never leak a future cue
    if (seen.has(c.startMs)) continue;
    // Sentence-span expansion makes neighboring citations overlap; keep the earliest.
    if (deduped.some((d) => spansOverlap(d, c))) continue;
    seen.add(c.startMs);
    deduped.push(c);
  }

  return deduped.slice(0, maxCitations);
}
