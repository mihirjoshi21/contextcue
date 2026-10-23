import type { Cue } from '@contextcue/core';

/**
 * Shared "make a single ASR-fragment cue readable" helper, used by both:
 *  - `citations.ts`, to expand each citation's displayed text into a fuller
 *    sentence-ish span instead of a raw fragment like "Drag a couple of those"
 *  - the mock provider's quoted lines, for the same reason in offline-demo mode
 *
 * ASR subtitle cues are chunked by pause/timing, not by sentence — a cue can end
 * mid-sentence ("somebody?"), start mid-sentence, or both. This joins a cue with its
 * strictly-adjacent neighbors (by `Cue.index`, not array position — a context's cue
 * list can have gaps where non-adjacent cues were pulled in by retrieval) backward
 * and forward until it hits sentence-ending punctuation, a budget, a gap, or the hard
 * ceiling (`safeMs`) — whichever comes first.
 */
const SENTENCE_END_RE = /[.!?]['")\]]*$/;

function endsSentence(text: string): boolean {
  return SENTENCE_END_RE.test(text.trim());
}

export function cleanCueText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export interface SentenceSpan {
  startMs: number;
  endMs: number;
  text: string;
}

export interface ExpandOptions {
  /** Max cues absorbed on each side of the base cue. Default 3. */
  maxEachSide?: number;
  /** Max total character length of the joined text. Default 160. */
  maxChars?: number;
}

/** Builds a `Cue.index -> Cue` lookup out of one or more cue arrays, deduping by index. */
export function buildCuesByIndex(...cueLists: Cue[][]): Map<number, Cue> {
  const map = new Map<number, Cue>();
  for (const list of cueLists) {
    for (const cue of list) {
      if (!map.has(cue.index)) map.set(cue.index, cue);
    }
  }
  return map;
}

/**
 * Expands `base` into a fuller sentence-ish span. `safeMs` is a HARD CEILING enforced
 * independently at every step of the walk (not just trusted from whatever the caller
 * already filtered) — a cue with `startMs > safeMs` is never absorbed, even if it's
 * the very next index and even if `base` itself doesn't end the sentence.
 */
export function expandToSentenceSpan(base: Cue, cuesByIndex: Map<number, Cue>, safeMs: number, opts: ExpandOptions = {}): SentenceSpan {
  const maxEachSide = opts.maxEachSide ?? 3;
  const maxChars = opts.maxChars ?? 160;

  const buffer: Cue[] = [base];
  let chars = cleanCueText(base.text).length;

  // Backward: keep prepending the previous-by-index cue as long as it reads like an
  // unfinished continuation (i.e. it does NOT itself end a sentence — if it did, it
  // would belong to an earlier sentence and must not be absorbed into this one).
  for (let n = 0; n < maxEachSide; n++) {
    const front = buffer[0] as Cue;
    const prev = cuesByIndex.get(front.index - 1);
    if (!prev) break;
    if (prev.startMs > safeMs) break; // hard ceiling, re-checked here regardless of caller
    if (endsSentence(prev.text)) break;
    const addLen = cleanCueText(prev.text).length + 1;
    if (chars + addLen > maxChars) break;
    buffer.unshift(prev);
    chars += addLen;
  }

  // Forward: only extend if the current tail doesn't already read as a finished
  // sentence; stop as soon as a joined cue completes one.
  for (let n = 0; n < maxEachSide; n++) {
    const back = buffer[buffer.length - 1] as Cue;
    if (endsSentence(back.text)) break;
    const next = cuesByIndex.get(back.index + 1);
    if (!next) break;
    if (next.startMs > safeMs) break; // hard ceiling, re-checked here regardless of caller
    const addLen = cleanCueText(next.text).length + 1;
    if (chars + addLen > maxChars) break;
    buffer.push(next);
    chars += addLen;
    if (endsSentence(next.text)) break;
  }

  const first = buffer[0] as Cue;
  const last = buffer[buffer.length - 1] as Cue;
  return {
    startMs: first.startMs,
    endMs: last.endMs,
    text: buffer.map((c) => cleanCueText(c.text)).join(' ')
  };
}
