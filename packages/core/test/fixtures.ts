import type { Cue } from '../src/types.js';

/** Builds a Cue from second offsets, to keep tests readable. */
export function cue(index: number, startSec: number, endSec: number, text: string): Cue {
  return { index, startMs: Math.round(startSec * 1000), endMs: Math.round(endSec * 1000), text };
}

/** A small, deterministic "story" used across several test files. */
export function sampleStory(): Cue[] {
  return [
    cue(1, 0, 3, 'Hey Alice, are you ready to go?'),
    cue(2, 3, 6, "Alice: I've been ready for an hour, Bob."),
    cue(3, 30, 34, 'Bob and Alice walk into the old lighthouse.'),
    cue(4, 60, 64, 'A mysterious note falls from the shelf.'),
    cue(5, 90, 95, 'Alice picks up the note and reads it aloud.'),
    cue(6, 150, 155, 'Oh Carol, I did not expect to see you here.'),
    cue(7, 156, 160, 'Carol: The lighthouse keeper sent me to find you two.'),
    cue(8, 220, 226, 'Bob asks Carol why the keeper disappeared last winter.'),
    cue(9, 300, 305, 'Carol explains that the keeper feared the storm.'),
    cue(10, 400, 405, 'Alice, Bob, and Carol decide to search the tower together.'),
    cue(11, 500, 506, 'They find an old logbook hidden behind a loose brick.'),
    cue(12, 600, 606, 'The logbook mentions a hidden room beneath the tower.'),
    cue(13, 700, 705, 'Bob eventually finds the trapdoor under the rug.'),
    cue(14, 800, 806, 'They descend into the hidden room together.')
  ];
}

/**
 * A synthetic feature-length film: one short line every `stepSec` seconds
 * for `durationSec` total, each line stamped with its own minute so tests
 * can assert *which* part of the film survived into a context/prompt.
 */
export function syntheticFilm(durationSec = 7200, stepSec = 15): Cue[] {
  const cues: Cue[] = [];
  let index = 0;
  for (let startSec = 0; startSec < durationSec; startSec += stepSec) {
    index += 1;
    const minute = Math.floor(startSec / 60);
    cues.push(
      cue(
        index,
        startSec,
        startSec + stepSec - 1,
        `Line at minute ${minute}: the characters discuss the ongoing plan and what to do next.`
      )
    );
  }
  return cues;
}
