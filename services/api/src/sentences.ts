/**
 * Small, shared sentence-boundary heuristic used by:
 *  - the mock provider, to emit a finished answer as discrete streamed chunks
 *  - the streaming ask pipeline (src/ask.ts), to buffer raw model deltas until
 *    a complete sentence is available, so `spoilerGuard` always runs on whole
 *    sentences and a partial (possibly leaking) sentence is never emitted.
 *
 * Mirrors the boundary regex `@contextcue/core`'s guard/characters modules use
 * internally (not exported from core, so duplicated here deliberately) —
 * split after `.`/`!`/`?` when followed by whitespace and a capital letter,
 * digit, or opening quote/bracket.
 */
const SENTENCE_BOUNDARY = /(?<=[.!?])[ \t]+(?=[A-Z0-9"'\[])|(?<=\n)/;

/** Splits a complete (finished) string into trimmed, non-empty sentences. */
export function splitCompleteSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed
    .split(SENTENCE_BOUNDARY)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Given a growing buffer of streamed text, returns any sentences that are
 * now complete (safe to guard + emit) and the remaining, still-incomplete
 * tail to keep buffering. If the buffer contains no boundary yet, returns no
 * sentences and the whole buffer as `rest`.
 */
export function extractCompleteSentences(buffer: string): { sentences: string[]; rest: string } {
  if (!buffer) return { sentences: [], rest: '' };
  const parts = buffer.split(SENTENCE_BOUNDARY);
  if (parts.length <= 1) return { sentences: [], rest: buffer };
  const rest = parts.pop() ?? '';
  return { sentences: parts, rest };
}
