/**
 * A single subtitle cue: a span of time during which a line of dialogue (or
 * on-screen text) is visible, together with the text itself.
 */
export interface Cue {
  /** 1-based position of this cue within its source file (or a synthesized
   * sequential index if the source file omitted numbering). */
  index: number;
  /** Start time in milliseconds, relative to the start of the media. */
  startMs: number;
  /** End time in milliseconds, relative to the start of the media. */
  endMs: number;
  /** Cue text with markup stripped and whitespace collapsed. */
  text: string;
}
