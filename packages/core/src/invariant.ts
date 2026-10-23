import type { Cue } from './types.js';

/**
 * The HARD CEILING: nothing with a start time after the current playback
 * position may ever reach the model. This is asserted (thrown, not just
 * logged) everywhere cues are assembled into context or prompt text, and is
 * exercised by property tests across random subtitle sets and positions.
 */
export function assertNoFutureCues(cues: readonly Cue[], positionMs: number): void {
  for (const cue of cues) {
    if (cue.startMs > positionMs) {
      throw new Error(
        `ContextCue hard ceiling violated: cue #${cue.index} starts at ${cue.startMs}ms, ` +
          `which is after the current playback position ${positionMs}ms`
      );
    }
  }
}
