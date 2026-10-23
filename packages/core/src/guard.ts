import type { Cue } from './types.js';
import type { SpoilerSafeContext } from './context.js';
import { parseTimestampToMs } from './format.js';
import { COMMON_CAPITALIZED_WORDS } from './lexicon.js';

export interface GuardResult {
  passed: boolean;
  flags: string[];
  sanitized: string;
}

const FUTURE_TENSE_PHRASES = [
  'will later',
  'will eventually',
  'eventually',
  'turns out',
  'it turns out',
  'as it turns out',
  'in the end',
  'spoiler',
  'foreshadow',
  "we'll see",
  'little did',
  'would later',
  'goes on to',
  'ends up',
  'ultimately',
  'later reveals',
  'later revealed',
  'is later revealed'
];

/** Exported so callers can recognize/reuse the exact fallback string
 * `spoilerGuard` substitutes when every sentence of an answer is flagged. */
export const SPOILER_SAFE_FALLBACK =
  "I can't answer that safely without risking a spoiler based on what's aired so far.";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const OPENER_CHARS = new Set(['"', "'", '[', '“', '‘']);

/** True if the first non-whitespace character before `matchIndex` in
 * `sentence` is an opening quote or bracket — used to avoid flagging a name
 * that's merely quoted or introduced in a bracketed aside, e.g. `"Celia,
 * run!"` or `[Zorg] appears`. */
function precededByOpener(sentence: string, matchIndex: number): boolean {
  let i = matchIndex - 1;
  while (i >= 0 && /\s/.test(sentence[i] ?? '')) i--;
  if (i < 0) return false;
  return OPENER_CHARS.has(sentence[i] ?? '');
}

const ABBREV_RE = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr)\./g;
const ABBREV_PLACEHOLDER = '\u2024';

/** Splits on sentence-ending punctuation and on line breaks (so plain
 * "Name — description" lines in `who` answers are separate units), without
 * cutting after honorific abbreviations like "Mr." or "Dr.". */
function splitSentences(text: string): string[] {
  return splitSentencesWithSeps(text).map((p) => p.text);
}

/** Like splitSentences, but remembers the separator that followed each unit
 * ("\n"-containing separators stay newlines; sentence-boundary whitespace is a
 * single space), so `sanitized` can re-join kept units without flattening lines. */
function splitSentencesWithSeps(text: string): { text: string; sep: string }[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const protectedText = trimmed.replace(ABBREV_RE, `$1${ABBREV_PLACEHOLDER}`);
  const parts = protectedText.split(/(\s*\n\s*|(?<=[.!?])\s+(?=[A-Z0-9"']))/);
  const out: { text: string; sep: string }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const t = (parts[i] ?? '').replaceAll(ABBREV_PLACEHOLDER, '.').trim();
    if (!t) {
      // empty unit: fold its separator into the previous one if it's a newline
      const sep = parts[i + 1] ?? '';
      if (out.length > 0 && sep.includes('\n')) out[out.length - 1]!.sep = '\n';
      continue;
    }
    const rawSep = parts[i + 1] ?? '';
    out.push({ text: t, sep: rawSep.includes('\n') ? '\n' : ' ' });
  }
  return out;
}

/** Masks markdown headings and bold/underline labels so their words are
 * never treated as candidate names (the text is left in `sanitized`). */
function maskMarkdown(sentence: string): string {
  return sentence
    .replace(/^\s*#{1,6}\s.*$/gm, ' ')
    .replace(/\*\*[^*]*\*\*/g, ' ')
    .replace(/__[^_]*__/g, ' ');
}

const CONTRACTION_SUFFIX_RE = /(?:'s|'ve|'re|'m|'ll|'d)$/i;

/** Normalizes a raw token: curly -> straight apostrophes, strips possessive
 * and contraction suffixes ("Barbara's" -> "Barbara", "They've" -> "They").
 * Returns null for "n't" contractions (always function words). */
function normalizeToken(raw: string): string | null {
  const w = raw.replace(/\u2019/g, "'");
  if (/n't$/i.test(w)) return null;
  return w.replace(CONTRACTION_SUFFIX_RE, '');
}

function contextText(context: SpoilerSafeContext): string {
  return context.recent
    .concat(context.retrieved)
    .map((c: Cue) => c.text)
    .join(' \n ');
}

function wordAppearsInContext(word: string, ctxText: string): boolean {
  const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
  return re.test(ctxText);
}

const WORD_RE = /[A-Za-z][A-Za-z'\u2019-]*/g;
const TIMESTAMP_RE = /\[?(\d{1,2}:)?\d{1,2}:\d{2}\]?/g;

/**
 * Defense-in-depth check run on a generated answer *after* the model
 * responds. Flags (per sentence):
 *  - future-tense / spoiler-signaling phrases ("eventually", "turns out", ...)
 *  - capitalized proper-noun-looking tokens (possessives/contractions
 *    normalized first: "Barbara's" -> "Barbara"; single letters and markdown
 *    headings/bold labels ignored). A SENTENCE-INITIAL token is only checked
 *    if the same token also appears capitalized mid-sentence elsewhere in
 *    the answer (i.e. it is being used as a name) — documented trade-off:
 *    a lone "Celia betrays him." passes, because sentence-initial
 *    capitalization alone is indistinguishable from ordinary grammar. Tokens
 *    that are not in `opts.allowedNames`, not a common capitalized word
 *    (so "The"/"He"/"Why"/"So"/"Earlier"/"At" etc. are never flagged
 *    regardless of position), not immediately preceded by an opening quote
 *    or `[` (a quoted aside or bracketed stage direction), and do not
 *    literally appear anywhere in the context text (a likely sign the model
 *    used outside "world knowledge" of the title)
 *  - a cited timestamp `[mm:ss]` / `mm:ss` later than `context.positionMs`
 *
 * Offending sentences are removed from `sanitized`; if nothing survives, a
 * safe fallback line is returned instead of an empty string.
 */
export function spoilerGuard(
  answer: string,
  context: SpoilerSafeContext,
  opts: { allowedNames?: string[] } = {}
): GuardResult {
  const allowedNames = new Set((opts.allowedNames ?? []).map((n) => n.toLowerCase()));
  const ctxText = contextText(context);
  const units = splitSentencesWithSeps(answer);
  const sentences = units.map((u) => u.text);
  const keptSeps: string[] = [];

  const midSentenceCapitalized = new Set<string>();
  for (const sentence of sentences) {
    const ms = [...maskMarkdown(sentence).matchAll(WORD_RE)];
    ms.forEach((m, i) => {
      if (i === 0 || !/^[A-Z]/.test(m[0])) return;
      const w = normalizeToken(m[0]);
      if (w && w.length >= 2) midSentenceCapitalized.add(w.toLowerCase());
    });
  }

  const flags: string[] = [];
  const keptSentences: string[] = [];

  for (const [idx, sentence] of sentences.entries()) {
    const sentenceFlags: string[] = [];
    const lowerSentence = sentence.toLowerCase();

    for (const phrase of FUTURE_TENSE_PHRASES) {
      if (lowerSentence.includes(phrase)) {
        sentenceFlags.push(`future-tense/spoiler phrase: "${phrase}"`);
      }
    }

    const scan = maskMarkdown(sentence);
    const wordMatches = [...scan.matchAll(WORD_RE)];
    for (let idx = 0; idx < wordMatches.length; idx++) {
      const match = wordMatches[idx] as RegExpMatchArray;
      if (!/^[A-Z]/.test(match[0])) continue; // only capitalized tokens are candidates
      const word = normalizeToken(match[0]);
      if (!word || word.length < 2) continue; // skip "U", "I", n't contractions
      const lower = word.toLowerCase();
      if (COMMON_CAPITALIZED_WORDS.has(lower)) continue; // safe regardless of position
      if (allowedNames.has(lower)) continue;
      if (precededByOpener(scan, match.index ?? 0)) continue; // quoted / bracketed aside
      // Sentence-initial capitalization is grammar, not evidence of a name:
      // only check it if the same token is also used capitalized mid-sentence
      // somewhere in the answer.
      if (idx === 0 && !midSentenceCapitalized.has(lower)) continue;
      if (wordAppearsInContext(word, ctxText)) continue;
      sentenceFlags.push(`possible world-knowledge leak: "${word}"`);
    }

    for (const match of sentence.matchAll(TIMESTAMP_RE)) {
      const raw = match[0].replace(/[[\]]/g, '');
      const ms = parseTimestampToMs(raw);
      if (ms !== null && ms > context.positionMs) {
        sentenceFlags.push(`cited timestamp ${raw} is after the current position`);
      }
    }

    if (sentenceFlags.length > 0) {
      flags.push(...sentenceFlags);
    } else {
      keptSentences.push(sentence);
      keptSeps.push(units[idx]?.sep ?? ' ');
    }
  }

  const sanitized =
    keptSentences.length > 0
      ? keptSentences.map((t, i) => (i < keptSentences.length - 1 ? t + (keptSeps[i] ?? ' ') : t)).join('')
      : SPOILER_SAFE_FALLBACK;

  return {
    passed: flags.length === 0,
    flags,
    sanitized
  };
}
