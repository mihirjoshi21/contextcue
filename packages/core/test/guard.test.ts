import { describe, it, expect } from 'vitest';
import { spoilerGuard } from '../src/guard.js';
import type { SpoilerSafeContext } from '../src/context.js';
import { cue } from './fixtures.js';

function ctxWith(text: string, positionMs = 300_000): SpoilerSafeContext {
  const cues = [cue(1, 0, 3, text)];
  return {
    positionMs,
    recent: cues,
    retrieved: [],
    full: true,
    cueCount: 1,
    charCount: text.length,
    maxCueStartMs: 0
  };
}

describe('spoilerGuard: clean answers pass', () => {
  it('passes a plain answer that only uses words present in the context', () => {
    const ctx = ctxWith('Bob and Alice found Carol near the old lighthouse.');
    const result = spoilerGuard('Bob and Alice found Carol near the lighthouse.', ctx);
    expect(result.passed).toBe(true);
    expect(result.flags).toEqual([]);
    expect(result.sanitized).toBe('Bob and Alice found Carol near the lighthouse.');
  });

  it('does not flag sentence-initial capitalized common words', () => {
    const ctx = ctxWith('Bob and Alice found Carol near the old lighthouse.');
    const answer = 'The three of them are friends. He asked why she came. Why did she come? They are curious.';
    const result = spoilerGuard(answer, ctx);
    expect(result.passed).toBe(true);
    expect(result.flags).toEqual([]);
  });

  it('does not flag a proper noun that appears in the context text', () => {
    const ctx = ctxWith('Carol explains that the keeper feared the storm near Millbrook.');
    const result = spoilerGuard('It happened near Millbrook, according to Carol.', ctx);
    expect(result.passed).toBe(true);
  });

  it('allows a name via opts.allowedNames even if absent from context text', () => {
    const ctx = ctxWith('Someone knocked on the door.');
    const result = spoilerGuard('It was probably Gandalf at the door.', ctx, { allowedNames: ['Gandalf'] });
    expect(result.passed).toBe(true);
  });
});

describe('spoilerGuard: leaks are flagged and sanitized', () => {
  it('flags future-tense / spoiler-signaling phrases', () => {
    const ctx = ctxWith('Bob and Alice walk into the lighthouse.');
    const result = spoilerGuard('It eventually turns out that Bob was right all along.', ctx);
    expect(result.passed).toBe(false);
    expect(result.flags.some((f) => /future-tense|spoiler/.test(f))).toBe(true);
    expect(result.sanitized).not.toContain('eventually');
  });

  it('flags a capitalized proper noun not present anywhere in context (world-knowledge leak)', () => {
    const ctx = ctxWith('Bob and Alice walk into the old lighthouse.');
    const result = spoilerGuard('This reminds me of Voldemort from another story.', ctx);
    expect(result.passed).toBe(false);
    expect(result.flags.some((f) => f.includes('Voldemort'))).toBe(true);
  });

  it('flags a cited timestamp after the current position', () => {
    const ctx = ctxWith('Bob and Alice walk into the lighthouse.', 60_000); // 1:00
    const result = spoilerGuard('As shown at [5:00], Bob finds the note.', ctx);
    expect(result.passed).toBe(false);
    expect(result.flags.some((f) => f.includes('timestamp'))).toBe(true);
  });

  it('does not flag a cited timestamp at or before the current position', () => {
    const ctx = ctxWith('Bob and Alice walk into the lighthouse.', 300_000); // 5:00
    const result = spoilerGuard('As shown at [1:00], Bob finds the note.', ctx);
    expect(result.passed).toBe(true);
  });

  it('removes only the offending sentence, keeping clean sentences', () => {
    const ctx = ctxWith('Bob and Alice walk into the old lighthouse.');
    const answer = 'Bob and Alice walk into the lighthouse. It eventually turns out to be haunted.';
    const result = spoilerGuard(answer, ctx);
    expect(result.sanitized).toBe('Bob and Alice walk into the lighthouse.');
  });

  it('falls back to a safe line when every sentence is flagged', () => {
    const ctx = ctxWith('Bob and Alice walk into the old lighthouse.');
    const result = spoilerGuard('Eventually, Voldemort turns out to be the villain.', ctx);
    expect(result.sanitized.length).toBeGreaterThan(0);
    expect(result.sanitized).not.toContain('Voldemort');
    expect(result.passed).toBe(false);
  });

  it('documented trade-off: a lone sentence-initial unknown name passes (indistinguishable from grammar)', () => {
    const ctx = ctxWith('Bob and Alice walk into the old lighthouse.');
    expect(spoilerGuard('Celia betrays him.', ctx).passed).toBe(true);
  });

  it('flags a sentence-initial unknown name when it is also used capitalized mid-sentence in the answer', () => {
    const ctx = ctxWith('Bob and Alice walk into the old lighthouse.');
    const result = spoilerGuard('Celia betrays him. He trusted Celia.', ctx);
    expect(result.passed).toBe(false);
    expect(result.flags.some((f) => f.includes('Celia'))).toBe(true);
    expect(result.sanitized).not.toContain('Celia');
  });
});

describe('spoilerGuard: real Haiku false positives (regression)', () => {
  const ctx = ctxWith('Barbara: Johnny, stop it. Karen is sick. Cooper and Ben argue. Helen tears a sheet.', 3_400_000);
  const clean = (a: string) => expect(spoilerGuard(a, ctx)).toMatchObject({ passed: true, flags: [] });

  it('normalizes possessives ("Barbara\'s brother Johnny was attacked")', () => {
    clean("Barbara's brother Johnny was attacked in the cemetery [32:04].");
    clean('Karen\u2019s condition worsens while Cooper\'s plan fails and Ben\'s idea helps.');
  });
  it('normalizes contractions and ignores single letters', () => {
    clean("She's worried and they've locked the door. I'm sure U can see it.");
    clean('Helen said she\'s tired, so Ben\'s helping.');
  });
  it('does not flag heading/label words at sentence start or mid-sentence', () => {
    clean('Based on the dialogue so far, Barbara is scared.');
    clean('Additionally, According to Ben, Helen is hurt. Current Status: Karen is sick.');
    clean('Mentioned earlier: Events at the house. Recap: Cooper argues.');
  });
  it('ignores markdown headings and bold labels', () => {
    clean('## Characters\n**Relationships** Barbara and Johnny are siblings.');
    clean('**Molotov** matters here.');
  });
  it('still flags a genuinely out-of-context mid-sentence name', () => {
    const r = spoilerGuard('Helen then meets Molotov at the door.', ctx);
    expect(r.passed).toBe(false);
    expect(r.flags.some((f) => f.includes('Molotov'))).toBe(true);
  });
  it('keeps a good sentence next to a bad one', () => {
    const r = spoilerGuard('Helen also tears a sheet to use as a bandage [52:54]. Karen is sick. Eventually Mullen arrives.', ctx);
    expect(r.sanitized).toContain('Helen also tears a sheet');
    expect(r.sanitized).toContain('Karen is sick');
    expect(r.sanitized).not.toContain('Mullen');
  });
  it('does not cut sentences after "Mr."/"Dr." abbreviations', () => {
    clean('Mr. Cooper argues with Ben.');
  });
});

describe('spoilerGuard: sentence-initial common words and quoted/bracketed asides', () => {
  it('does not flag an extensive set of common sentence-starters (pronouns, question words, articles, conjunctions, prepositions, discourse markers)', () => {
    const ctx = ctxWith('Bob and Alice walk into the old lighthouse.');
    const answer =
      'So it happened quickly. Yes, that is true. Earlier, they spoke. Right away, they left. ' +
      'Well, nobody knows. Here they stood. There it was. This is fine. That works. ' +
      'At dawn, they woke. In town, they wandered. After dinner, they rested. ' +
      'Before noon, they departed. When morning came, they smiled. While walking, they talked.';
    const result = spoilerGuard(answer, ctx);
    expect(result.flags).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('skips a capitalized token immediately after an opening double quote', () => {
    const ctx = ctxWith('Bob and Alice walk into the old lighthouse.');
    const result = spoilerGuard('"Celia, wait!" he shouted.', ctx);
    expect(result.passed).toBe(true);
    expect(result.flags).toEqual([]);
  });

  it('skips a capitalized token immediately after an opening bracket, even mid-sentence', () => {
    const ctx = ctxWith('Bob and Alice walk into the old lighthouse.');
    const result = spoilerGuard('Suddenly [Zorg] approaches from the shadows.', ctx);
    expect(result.passed).toBe(true);
    expect(result.flags).toEqual([]);
  });

  it('still flags a quoted proper noun that is NOT directly after the opening quote', () => {
    const ctx = ctxWith('Bob and Alice walk into the old lighthouse.');
    // "Zorg" here is the second word inside the quotes, not right after the opener,
    // so the quote/bracket exemption must not swallow it.
    const result = spoilerGuard('She said, "meet Zorg tomorrow."', ctx);
    expect(result.passed).toBe(false);
    expect(result.flags.some((f) => f.includes('Zorg'))).toBe(true);
  });
});

describe('spoilerGuard: line structure', () => {
  it('keeps newlines between "Name — description" lines when nothing is removed', () => {
    const ctx = ctxWith('Barbara is here. Johnny is here. Ben is here.');
    const answer = 'Barbara — a woman\nJohnny — her brother\nBen — a man';
    const r = spoilerGuard(answer, ctx);
    expect(r.passed).toBe(true);
    expect(r.sanitized).toBe(answer);
  });

  it('keeps line structure for the surviving lines when one is removed', () => {
    const ctx = ctxWith('Barbara is here. Johnny is here.');
    const r = spoilerGuard('Barbara — a woman\nJohnny — it turns out he dies\nBarbara — again', ctx);
    expect(r.passed).toBe(false);
    expect(r.sanitized).toBe('Barbara — a woman\nBarbara — again');
  });
});
