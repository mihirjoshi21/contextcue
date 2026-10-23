import type { Cue } from './types.js';
import { Bm25Index } from './bm25.js';
import { assertNoFutureCues } from './invariant.js';

/**
 * Returns cues whose start time is at or before `positionMs`, chronologically
 * ordered. This is the HARD CEILING primitive: a cue that straddles the
 * playhead (started before `positionMs` but hasn't ended yet) is included —
 * it's on screen right now — but nothing that starts after `positionMs` ever
 * is. Every other function in this package that assembles context builds on
 * top of this filter.
 */
export function cuesUpTo(cues: readonly Cue[], positionMs: number): Cue[] {
  return cues
    .filter((c) => c.startMs <= positionMs)
    .sort((a, b) => a.startMs - b.startMs || a.index - b.index);
}

export interface ContextOptions {
  /** How far back (ms) counts as "recent" and is always included verbatim. Default 180000 (3 min). */
  recentWindowMs?: number;
  /** Soft character budget for the assembled context. Default 60000 (~15k tokens —
   * comfortable for Claude Haiku latency/cost, and large enough that "catch me up"
   * on a feature-length film doesn't collapse to just the recent window). */
  maxChars?: number;
  /** Max number of BM25 hits (each expanded with ±1 neighbor cues) pulled from outside the recent window. Default 12. */
  retrieveK?: number;
  /**
   * How to fill the budget beyond the recent window, when not everything fits:
   *  - `'retrieval'`: BM25 hits (+ neighbors) against `question` only. If the
   *    question is blank or matches nothing, no older cues are added at all.
   *  - `'coverage'`: ignore the question; evenly stride-sample older cues
   *    across the *entire* past so the model sees the whole story's shape,
   *    not just whatever BM25 happened to match.
   *  - `'auto'` (default): do BM25 retrieval when `question` is non-empty,
   *    then always spend any leftover budget on coverage sampling of the
   *    remaining older cues. This is what makes recap/who/scene — which
   *    typically pass an empty `question` — actually summarize the whole
   *    past instead of silently degrading to the last few minutes.
   */
  strategy?: 'auto' | 'retrieval' | 'coverage';
}

export interface SpoilerSafeContext {
  positionMs: number;
  /** Cues within `recentWindowMs` of the playhead, included verbatim. */
  recent: Cue[];
  /** Older cues pulled in by BM25 relevance to the question, plus ±1 neighbors, deduped. */
  retrieved: Cue[];
  /** true when the entire past transcript fit inside maxChars (no retrieval needed). */
  full: boolean;
  cueCount: number;
  charCount: number;
  /** Max startMs among cues actually included. Invariant: always <= positionMs. */
  maxCueStartMs: number;
}

/** Per-cue character cost used for budgeting: text length plus an estimate
 * of the `[hh:mm:ss] ` timestamp prefix and line break that buildPrompt adds. */
function cueChars(cue: Cue): number {
  return cue.text.length + 12;
}

/**
 * Picks cues evenly spread across `available` (already chronological) so the
 * sample covers its *whole* span rather than clustering, adding a candidate
 * only if it still fits within `budget`. Used to give recap/who/scene — and
 * any other leftover budget — chronological coverage of the whole past
 * instead of relying solely on BM25 relevance to a (often empty) question.
 */
function strideSampleWithinBudget(available: readonly Cue[], budget: number): Cue[] {
  if (available.length === 0 || budget <= 0) return [];

  const totalChars = available.reduce((sum, c) => sum + cueChars(c), 0);
  if (totalChars <= budget) return available.slice();

  const avgChars = totalChars / available.length;
  const targetCount = Math.max(1, Math.min(available.length, Math.floor(budget / avgChars)));
  const stride = available.length / targetCount;

  const selected: Cue[] = [];
  const seenIndices = new Set<number>();
  let used = 0;
  for (let pos = 0; Math.floor(pos) < available.length; pos += stride) {
    const idx = Math.floor(pos);
    if (seenIndices.has(idx)) continue;
    seenIndices.add(idx);
    const c = available[idx] as Cue;
    const cost = cueChars(c);
    if (used + cost > budget) continue; // skip this slot, keep striding for coverage
    selected.push(c);
    used += cost;
  }
  return selected;
}

function finalize(positionMs: number, recent: Cue[], retrieved: Cue[], full: boolean): SpoilerSafeContext {
  const all = recent.concat(retrieved);
  // HARD CEILING, asserted: this must never be able to fire given the logic
  // above, but we check it directly rather than trusting the composition.
  assertNoFutureCues(all, positionMs);
  const charCount = all.reduce((sum, c) => sum + cueChars(c), 0);
  const maxCueStartMs = all.length > 0 ? Math.max(...all.map((c) => c.startMs)) : 0;
  return {
    positionMs,
    recent,
    retrieved,
    full,
    cueCount: all.length,
    charCount,
    maxCueStartMs
  };
}

/**
 * Assembles a spoiler-safe context window for `question` at `positionMs`.
 *
 * If the entire past transcript fits inside `maxChars`, everything is
 * included (`full: true`). Otherwise the last `recentWindowMs` of dialogue is
 * included verbatim, plus (per `opts.strategy`, default `'auto'`) up to
 * `retrieveK` older cues most relevant to the question (BM25) and/or an
 * evenly stride-sampled slice of the remaining older cues spanning the whole
 * past — each BM25 hit expanded with its immediate ±1 neighbor cues for
 * context — deduplicated, and returned in chronological order. Everything
 * returned satisfies the hard ceiling: no cue with `startMs > positionMs`.
 */
export function buildContext(
  cues: readonly Cue[],
  positionMs: number,
  question: string,
  opts: ContextOptions = {}
): SpoilerSafeContext {
  const recentWindowMs = opts.recentWindowMs ?? 180_000;
  const maxChars = opts.maxChars ?? 60_000;
  const retrieveK = opts.retrieveK ?? 12;
  const strategy = opts.strategy ?? 'auto';

  const past = cuesUpTo(cues, positionMs);
  assertNoFutureCues(past, positionMs);

  if (past.length === 0) {
    return { positionMs, recent: [], retrieved: [], full: true, cueCount: 0, charCount: 0, maxCueStartMs: 0 };
  }

  const totalChars = past.reduce((sum, c) => sum + cueChars(c), 0);
  if (totalChars <= maxChars) {
    return finalize(positionMs, past, [], true);
  }

  const cutoffMs = positionMs - recentWindowMs;
  const recentCandidates = past.filter((c) => c.startMs >= cutoffMs);
  const olderCandidates = past.filter((c) => c.startMs < cutoffMs);

  // The recent window is included verbatim. If even that busts the budget
  // (extremely dense dialogue), keep the most recent lines that fit.
  let recent = recentCandidates;
  let recentChars = recent.reduce((sum, c) => sum + cueChars(c), 0);
  if (recentChars > maxChars) {
    const kept: Cue[] = [];
    let chars = 0;
    for (let i = recentCandidates.length - 1; i >= 0; i--) {
      const c = recentCandidates[i] as Cue;
      const next = chars + cueChars(c);
      if (next > maxChars) break;
      kept.unshift(c);
      chars = next;
    }
    recent = kept;
    recentChars = chars;
  }

  const includedSet = new Set<Cue>(recent);
  let remainingBudget = maxChars - recentChars;
  const retrieved: Cue[] = [];

  const useRetrieval = strategy !== 'coverage' && question.trim().length > 0;
  // 'auto' always tops up leftover budget with coverage sampling (whether or
  // not retrieval ran, and whether or not it found hits) — this is what
  // keeps recap/who/scene (typically an empty question) from silently
  // collapsing to just the recent window on a long transcript. 'retrieval'
  // never tops up, to preserve pure-relevance behavior when a caller asks
  // for it explicitly. 'coverage' is pure stride-sampling regardless of
  // whether a question was given.
  const shouldTopUpWithCoverage = strategy === 'coverage' || strategy === 'auto';

  if (remainingBudget > 0 && olderCandidates.length > 0 && useRetrieval) {
    const bm25 = new Bm25Index(olderCandidates.map((c) => c.text));
    const positionInPast = new Map<Cue, number>();
    past.forEach((c, i) => positionInPast.set(c, i));

    const scored = olderCandidates
      .map((cue, i) => ({ cue, score: bm25.score(question, i) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, retrieveK);

    for (const { cue } of scored) {
      const pos = positionInPast.get(cue);
      if (pos === undefined) continue;
      const group: Cue[] = [];
      for (const p of [pos - 1, pos, pos + 1]) {
        if (p < 0 || p >= past.length) continue;
        const candidate = past[p] as Cue;
        if (includedSet.has(candidate) || group.includes(candidate)) continue;
        group.push(candidate);
      }
      if (group.length === 0) continue;
      const groupChars = group.reduce((sum, c) => sum + cueChars(c), 0);
      if (groupChars <= remainingBudget) {
        for (const c of group) {
          includedSet.add(c);
          retrieved.push(c);
        }
        remainingBudget -= groupChars;
      }
      // Otherwise skip this hit's whole neighbor-group rather than
      // truncating it mid-context.
    }
  }

  if (remainingBudget > 0 && olderCandidates.length > 0 && shouldTopUpWithCoverage) {
    const availableForCoverage = olderCandidates.filter((c) => !includedSet.has(c));
    const coverage = strideSampleWithinBudget(availableForCoverage, remainingBudget);
    for (const c of coverage) {
      includedSet.add(c);
      retrieved.push(c);
      remainingBudget -= cueChars(c);
    }
  }

  retrieved.sort((a, b) => a.startMs - b.startMs || a.index - b.index);

  return finalize(positionMs, recent, retrieved, false);
}
