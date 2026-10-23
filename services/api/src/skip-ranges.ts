import type { Cue } from '@contextcue/core';
import type { SkipRange } from './types.js';

/**
 * Filters out cues that start within any of a title's `skipRanges` (e.g. a
 * broadcast host's intro/outro baked into the video file, see SPEC.md) — the
 * viewer never actually watched those spans, so nothing in them should ever
 * reach `buildContext`, `extractCharacters`, or an MCP tool's answer. Applied
 * before every one of those, at the two call sites that load cues
 * (`answerQuestion`/`answerQuestionStream` in `src/ask.ts`, and
 * `GET /v1/titles/:id/characters` in `src/app.ts`) — MCP goes through
 * `answerQuestion` too, so it's covered for free.
 *
 * Uses a half-open interval `[startMs, endMs)` for each range, consistent
 * with how cue windows are treated elsewhere in this package.
 */
export function filterSkipRanges(cues: readonly Cue[], skipRanges: readonly SkipRange[] | undefined): Cue[] {
  if (!skipRanges || skipRanges.length === 0) return [...cues];
  return cues.filter((cue) => !skipRanges.some((range) => cue.startMs >= range.startMs && cue.startMs < range.endMs));
}
