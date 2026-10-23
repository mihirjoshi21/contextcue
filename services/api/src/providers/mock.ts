import { extractCharacters, formatTimestamp, type Cue, type SpoilerSafeContext } from '@contextcue/core';
import { splitCompleteSentences } from '../sentences.js';
import { buildCuesByIndex, expandToSentenceSpan } from '../sentence-span.js';
import type { AiProvider, AskResult } from '../types.js';

const NOTHING_YET =
  "Nothing has happened yet at this point in the story, so there's nothing to tell you.";
const RECAP_PREFACE = 'Offline demo mode — key lines so far:';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'what', 'who', 'why', 'how', 'when', 'where',
  'did', 'does', 'do', 'so', 'far', 'just', 'happened', 'has', 'have', 'had', 'to', 'of', 'in',
  'on', 'at', 'that', 'this', 'it', 'and', 'or', 'about', 'me', 'up', 'catch', 'i', 'my'
]);

function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  return words.filter((w) => !STOPWORDS.has(w));
}

/**
 * Quotes a cue as a fuller sentence-ish span (joining strictly-adjacent cues, per
 * `expandToSentenceSpan`) instead of a raw ASR fragment — same readability fix as
 * `citations.ts`, so the offline demo reads naturally too. `safeMs` is always
 * `context.maxCueStartMs`, the same hard ceiling `citations.ts` uses, re-checked
 * inside the expansion regardless of what's already in `cuesByIndex`.
 */
function formatCueLine(cue: Cue, cuesByIndex: Map<number, Cue>, safeMs: number): string {
  const span = expandToSentenceSpan(cue, cuesByIndex, safeMs);
  return `${span.text} [${formatTimestamp(span.startMs)}]`;
}

function formatLines(cues: Cue[], context: SpoilerSafeContext): string {
  const cuesByIndex = buildCuesByIndex(context.recent, context.retrieved);
  const safeMs = context.maxCueStartMs;
  return cues.map((c) => formatCueLine(c, cuesByIndex, safeMs)).join(' ');
}

/** Chronological, de-duplicated union of a context's recent + retrieved cues. */
function mergedChronologicalCues(context: SpoilerSafeContext): Cue[] {
  const byKey = new Map<string, Cue>();
  for (const cue of context.recent.concat(context.retrieved)) {
    byKey.set(`${cue.index}:${cue.startMs}`, cue);
  }
  return [...byKey.values()].sort((a, b) => a.startMs - b.startMs || a.index - b.index);
}

/** Picks `count` cues stride-sampled evenly across `cues` (first..last inclusive). */
function strideSample(cues: Cue[], count: number): Cue[] {
  if (cues.length <= count) return cues;
  const picked: Cue[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < count; i++) {
    const idx = count === 1 ? 0 : Math.round((i * (cues.length - 1)) / (count - 1));
    if (!seen.has(idx)) {
      seen.add(idx);
      picked.push(cues[idx] as Cue);
    }
  }
  return picked;
}

function askAnswer(context: SpoilerSafeContext, question: string): string {
  const pool = context.retrieved.length > 0 ? context.retrieved : context.recent;
  if (pool.length === 0) return NOTHING_YET;

  const qWords = tokenize(question);
  const scored = pool.map((cue) => ({
    cue,
    score: qWords.reduce((sum, w) => sum + (tokenize(cue.text).includes(w) ? 1 : 0), 0)
  }));

  const hasSignal = scored.some((s) => s.score > 0);
  const picked = hasSignal
    ? scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score || a.cue.startMs - b.cue.startMs)
        .slice(0, 3)
        .map((s) => s.cue)
        .sort((a, b) => a.startMs - b.startMs)
    : pool.slice(-3);

  return formatLines(picked, context);
}

function recapAnswer(context: SpoilerSafeContext): string {
  const merged = mergedChronologicalCues(context);
  if (merged.length === 0) return `${RECAP_PREFACE} nothing has happened yet.`;
  const picked = strideSample(merged, Math.min(4, merged.length));
  return `${RECAP_PREFACE} ${formatLines(picked, context)}`;
}

function whoAnswer(context: SpoilerSafeContext): string {
  const merged = mergedChronologicalCues(context);
  const mentions = extractCharacters(merged, context.positionMs);
  if (mentions.length === 0) return 'No named characters have been introduced yet.';
  const list = mentions
    .slice(0, 6)
    .map((m) => `${m.name} (first heard ${formatTimestamp(m.firstSeenMs)})`)
    .join(', ');
  return `Named so far: ${list}.`;
}

function sceneAnswer(context: SpoilerSafeContext): string {
  const pool = context.recent.length > 0 ? context.recent : context.retrieved;
  if (pool.length === 0) return NOTHING_YET;
  return formatLines(pool.slice(-3), context);
}

function buildAnswer(context: SpoilerSafeContext, mode: string, question: string): string {
  switch (mode) {
    case 'recap':
      return recapAnswer(context);
    case 'who':
      return whoAnswer(context);
    case 'scene':
      return sceneAnswer(context);
    case 'ask':
    default:
      return askAnswer(context, question);
  }
}

/**
 * MockProvider: a fully deterministic, offline-safe "AI". Mode-aware and clearly
 * labeled as a demo fallback (recap mode) rather than pretending to be a real
 * model, so an offline judge/demo run is honest about what's happening. Every
 * mode builds its answer purely from cues already present in the spoiler-safe
 * context, so the whole demo works with zero AWS credentials.
 */
export const mockProvider: AiProvider = {
  name: 'mock',
  model: 'mock-extractive-v1',
  // "Offline" (from RECAP_PREFACE below) is our own scaffolding, not a
  // transcript word — spoilerGuard's context-membership check can't see it
  // and would otherwise flag it as a possible world-knowledge leak.
  guardAllowedNames: ['Offline'],

  async ask(_built, context, meta): Promise<AskResult> {
    return { text: buildAnswer(context, meta.mode, meta.question), model: mockProvider.model };
  },

  async *askStream(built, context, meta) {
    const { text } = await mockProvider.ask(built, context, meta);
    for (const sentence of splitCompleteSentences(text)) {
      yield `${sentence} `;
    }
  }
};
