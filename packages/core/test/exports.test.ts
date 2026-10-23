import { describe, it, expect } from 'vitest';
import * as core from '../src/index.js';
import { SPOILER_SAFE_FALLBACK } from '../src/guard.js';
import { VERSION } from '../src/version.js';

describe('package-level exports', () => {
  it('exports a semver-shaped VERSION constant', () => {
    expect(core.VERSION).toBe(VERSION);
    expect(core.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exports SPOILER_SAFE_FALLBACK matching the string spoilerGuard falls back to', () => {
    expect(core.SPOILER_SAFE_FALLBACK).toBe(SPOILER_SAFE_FALLBACK);
    expect(core.SPOILER_SAFE_FALLBACK.length).toBeGreaterThan(0);

    const ctx = {
      positionMs: 0,
      recent: [],
      retrieved: [],
      full: true,
      cueCount: 0,
      charCount: 0,
      maxCueStartMs: 0
    };
    const result = core.spoilerGuard('Eventually, Voldemort turns out to be the villain.', ctx);
    expect(result.sanitized).toBe(core.SPOILER_SAFE_FALLBACK);
  });
});
