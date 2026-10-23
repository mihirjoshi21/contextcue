import { describe, it, expect } from 'vitest';
import { assertNoFutureCues } from '../src/invariant.js';
import { cue } from './fixtures.js';

describe('assertNoFutureCues (HARD CEILING)', () => {
  it('throws when a cue starts after positionMs', () => {
    const cues = [cue(1, 0, 2, 'past'), cue(2, 100, 102, 'future')];
    expect(() => assertNoFutureCues(cues, 50_000)).toThrow(/hard ceiling/i);
  });

  it('does not throw when every cue starts at or before positionMs', () => {
    const cues = [cue(1, 0, 2, 'past'), cue(2, 10, 12, 'also past')];
    expect(() => assertNoFutureCues(cues, 12_000)).not.toThrow();
  });

  it('does not throw on an empty cue list', () => {
    expect(() => assertNoFutureCues([], 0)).not.toThrow();
  });

  it('treats a cue starting exactly at positionMs as allowed (boundary)', () => {
    const cues = [cue(1, 10, 12, 'boundary')];
    expect(() => assertNoFutureCues(cues, 10_000)).not.toThrow();
  });
});
