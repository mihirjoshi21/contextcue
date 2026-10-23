import type { Cue } from './types.js';
import { cuesUpTo } from './context.js';
import {
  STOPWORDS,
  DAYS_MONTHS,
  COMMON_CAPITALIZED_WORDS,
  INTERJECTION_ADDRESS_WORDS,
  GENERIC_CAPITALIZED_NOUNS,
  US_STATES,
  LARGE_CITIES
} from './lexicon.js';

export interface CharacterMention {
  name: string;
  firstSeenMs: number;
  mentions: number;
}

export interface ExtractCharactersOptions {
  /** Minimum total capitalized mentions (across the whole past) a candidate
   * needs, once it has qualified via at least one mid-sentence, vocative, or
   * honorific-address occurrence, to be reported. Default 2 — filters out
   * names that only ever appear as a single passing mention (often noise on
   * messy auto-generated subtitles). */
  minMentions?: number;
}

const HONORIFIC_WORDS: ReadonlySet<string> = new Set(['mr', 'mrs', 'ms', 'miss', 'dr']);
const INTERJECTION_TRIGGERS: ReadonlySet<string> = new Set(['hey', 'hi', 'oh', 'yo', 'look', 'listen', 'okay', 'ok']);
const PLACE_PREPOSITIONS: ReadonlySet<string> = new Set(['in', 'to', 'from', 'at', 'near']);

/** Matches an honorific followed by a capitalized name anywhere in the raw
 * cue text — deliberately independent of sentence splitting, because
 * splitting on `.` (as `splitSentences` does) would otherwise always cut
 * "Mr." away from the name right after it. */
const HONORIFIC_NAME_RE = /\b(Mr|Mrs|Ms|Miss|Dr)\.?\s+([A-Z][a-zA-Z'’-]+)/g;

function honorificLabel(honorific: string): string {
  const normalized = honorific[0]?.toUpperCase() + honorific.slice(1).toLowerCase();
  return normalized === 'Miss' ? 'Miss' : `${normalized}.`;
}

function stripPossessive(word: string): string {
  return word.replace(/['’]s$/i, '');
}

function isAllCapsShort(word: string): boolean {
  return word.length > 0 && word.length <= 3 && word === word.toUpperCase() && /[A-Z]/.test(word);
}

function isNoiseWord(word: string): boolean {
  if (isAllCapsShort(word)) return true;
  const lower = word.toLowerCase();
  return (
    STOPWORDS.has(lower) ||
    DAYS_MONTHS.has(lower) ||
    COMMON_CAPITALIZED_WORDS.has(lower) ||
    INTERJECTION_ADDRESS_WORDS.has(lower) ||
    GENERIC_CAPITALIZED_NOUNS.has(lower) ||
    US_STATES.has(lower) ||
    LARGE_CITIES.has(lower) ||
    HONORIFIC_WORDS.has(lower) // "Mr"/"Dr"/... are never themselves a name
  );
}

function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

interface CandidateStats {
  count: number;
  firstSeenMs: number;
  qualifies: boolean; // saw >=1 mid-sentence, vocative, or honorific-address occurrence
  placePrecededCount: number;
  honorificVotes: Map<string, number>;
}

/**
 * Heuristic, past-only character extraction, hardened against messy
 * real-world (ASR-generated) subtitles:
 *  - Only ever considers tokens that are capitalized — a token is a
 *    candidate at all only if it starts with an uppercase letter, so a
 *    lowercase word (e.g. a vocative interjection regex accidentally
 *    matching case-insensitively) can never surface as a "name".
 *  - A candidate must *qualify* via at least one mid-sentence occurrence, a
 *    vocative-address occurrence ("Hey John", "John, ..."), or an
 *    honorific-address occurrence ("Mr. Cooper") — but once qualified,
 *    every capitalized occurrence (including sentence-initial ones) counts
 *    toward `mentions`.
 *  - Interjections/forms of address ("Jeez", "Boys", "Man", "Sir", ...),
 *    short all-caps acronyms ("TV", "OK"), ASR-common institutional nouns
 *    ("Police", "Radio", "Church", ...), US states, and a working list of
 *    ~100 large US/world cities are excluded outright. A token that follows
 *    "in"/"to"/"from"/"at"/"near" in at least half of its occurrences is
 *    also excluded (likely a place, even if not in the built-in gazetteer).
 *  - A trailing possessive `'s` is stripped ("Beakman's" -> "Beakman").
 *  - "Mr./Mrs./Ms./Miss/Dr. Name" is reported with the honorific kept
 *    ("Mr. Cooper"), not just the bare surname.
 *  - Nickname merging: if one qualifying name is a prefix of another
 *    qualifying name (e.g. "John"/"Johnny", "Barb"/"Barbara"), they're
 *    merged into the longer form, with summed mentions and the earliest
 *    `firstSeenMs`.
 *  - Requires `opts.minMentions` (default 2) total mentions to be reported.
 *
 * Only cues at or before `positionMs` are considered — nothing about
 * characters introduced later ever leaks out.
 */
export function extractCharacters(
  cues: readonly Cue[],
  positionMs: number,
  opts: ExtractCharactersOptions = {}
): CharacterMention[] {
  const minMentions = opts.minMentions ?? 2;
  const past = cuesUpTo(cues, positionMs);

  const stats = new Map<string, CandidateStats>();

  const getOrCreate = (name: string, ms: number): CandidateStats => {
    let entry = stats.get(name);
    if (!entry) {
      entry = { count: 0, firstSeenMs: ms, qualifies: false, placePrecededCount: 0, honorificVotes: new Map() };
      stats.set(name, entry);
    } else {
      entry.firstSeenMs = Math.min(entry.firstSeenMs, ms);
    }
    return entry;
  };

  const record = (
    rawWord: string,
    ms: number,
    opts2: { qualifies: boolean; precededByPlace: boolean }
  ): void => {
    if (!/^[A-Z]/.test(rawWord)) return; // never a candidate unless capitalized
    const name = stripPossessive(rawWord);
    if (!name || isNoiseWord(name)) return;

    const entry = getOrCreate(name, ms);
    entry.count += 1;
    if (opts2.qualifies) entry.qualifies = true;
    if (opts2.precededByPlace) entry.placePrecededCount += 1;
  };

  for (const cue of past) {
    for (const sentence of splitSentences(cue.text)) {
      const matches = [...sentence.matchAll(/[A-Za-z][A-Za-z'’-]*/g)];
      matches.forEach((match, idx) => {
        const word = match[0];
        if (!/^[A-Z]/.test(word)) return; // lowercase tokens are never candidates

        const prevWord = idx > 0 ? matches[idx - 1]?.[0] ?? null : null;
        const afterChar = sentence[(match.index ?? 0) + word.length] ?? '';

        const isVocativeByInterjection = !!prevWord && INTERJECTION_TRIGGERS.has(prevWord.toLowerCase());
        const isVocativeByComma = afterChar === ',';
        const isVocative = isVocativeByInterjection || isVocativeByComma;
        const isMidSentence = idx !== 0;

        const precededByPlace = !!prevWord && PLACE_PREPOSITIONS.has(prevWord.toLowerCase());

        record(word, cue.startMs, { qualifies: isMidSentence || isVocative, precededByPlace });
      });
    }

    // Honorific pass over the *raw* cue text, independent of sentence
    // splitting (which would otherwise always cut "Mr." away from the name
    // right after it, since it ends in a period).
    for (const match of cue.text.matchAll(HONORIFIC_NAME_RE)) {
      const honorific = match[1];
      const rawName = match[2];
      if (!honorific || !rawName || !/^[A-Z]/.test(rawName)) continue;
      const name = stripPossessive(rawName);
      if (!name || isNoiseWord(name)) continue;

      const entry = getOrCreate(name, cue.startMs);
      entry.qualifies = true; // being addressed by title is itself an address
      entry.honorificVotes.set(honorific, (entry.honorificVotes.get(honorific) ?? 0) + 1);
    }
  }

  // Exclude tokens that follow a place preposition ("in"/"to"/"from"/"at"/"near")
  // in at least half of their occurrences — likely a place name even if it
  // isn't in the built-in state/city lists.
  const qualified = [...stats.entries()].filter(
    ([, s]) => s.qualifies && s.count >= minMentions && s.placePrecededCount / s.count < 0.5
  );

  // Nickname merge: if a shorter qualifying name is an exact prefix of a
  // longer qualifying name, fold it into the longer one.
  const byName = new Map(qualified);
  const names = [...byName.keys()].sort((a, b) => b.length - a.length); // longest first
  const absorbedInto = new Map<string, string>();
  const merged = new Map<string, CandidateStats>();

  for (const name of names) {
    if (absorbedInto.has(name)) continue;
    const entry = byName.get(name);
    if (!entry) continue;
    const combined: CandidateStats = { ...entry, honorificVotes: new Map(entry.honorificVotes) };

    for (const other of names) {
      if (other === name || absorbedInto.has(other)) continue;
      if (other.length >= 2 && name.startsWith(other)) {
        const otherEntry = byName.get(other);
        if (!otherEntry) continue;
        combined.count += otherEntry.count;
        combined.firstSeenMs = Math.min(combined.firstSeenMs, otherEntry.firstSeenMs);
        for (const [h, c] of otherEntry.honorificVotes) {
          combined.honorificVotes.set(h, (combined.honorificVotes.get(h) ?? 0) + c);
        }
        absorbedInto.set(other, name);
      }
    }
    merged.set(name, combined);
  }

  const results: CharacterMention[] = [];
  for (const [name, entry] of merged) {
    let displayName = name;
    if (entry.honorificVotes.size > 0) {
      const sorted = [...entry.honorificVotes.entries()].sort((a, b) => b[1] - a[1]);
      const topHonorific = sorted[0]?.[0];
      if (topHonorific) displayName = `${honorificLabel(topHonorific)} ${name}`;
    }
    results.push({ name: displayName, firstSeenMs: entry.firstSeenMs, mentions: entry.count });
  }

  results.sort((a, b) => a.firstSeenMs - b.firstSeenMs || a.name.localeCompare(b.name));
  return results;
}
