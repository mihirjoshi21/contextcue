import { describe, it, expect } from 'vitest';
import { buildContext, buildPrompt } from '@contextcue/core';
import { mockProvider } from '../src/providers/mock.js';
import type { AskMeta } from '../src/types.js';

// A small, hand-built cue set. Alice/Bob are each mentioned twice — once
// qualifying (mid-sentence or "Look, <Name>" vocative) and at least twice
// total — to satisfy core.extractCharacters's default minMentions=2 filter.
// Also includes enough spread of cues to exercise recap's stride sampling,
// scene's "last three lines", and one line that clearly overlaps a specific
// "ask" question so the overlap-scoring picks it out.
const CUES = [
  { index: 1, startMs: 1000, endMs: 4000, text: 'Look, Alice arrived first.' },
  { index: 2, startMs: 5000, endMs: 8000, text: 'Bob was surprised to see Alice again.' },
  { index: 3, startMs: 10_000, endMs: 14_000, text: 'Look, Bob arrived next.' },
  { index: 4, startMs: 16_000, endMs: 20_000, text: 'They found a strange brass key in the drawer.' },
  { index: 5, startMs: 20_000, endMs: 24_000, text: 'Someone warned that the key looked important.' },
  { index: 6, startMs: 26_000, endMs: 30_000, text: 'Someone put the key in a pocket and left.' }
];
const POSITION_MS = 26_000;

function contextFor(question: string) {
  return buildContext(CUES, POSITION_MS, question);
}

function metaFor(mode: AskMeta['mode'], question: string): AskMeta {
  return { mode, question };
}

describe('MockProvider — mode-aware offline demo behavior', () => {
  it('ask: picks cues overlapping the question words (deterministic)', async () => {
    const question = 'What did they find in the drawer?';
    const context = contextFor(question);
    const built = buildPrompt({ mode: 'ask', question, context });

    const result1 = await mockProvider.ask(built, context, metaFor('ask', question));
    const result2 = await mockProvider.ask(built, context, metaFor('ask', question));

    expect(result1.text).toBe(result2.text); // deterministic
    expect(result1.text).toContain('brass key');
  });

  it('ask: falls back to the most recent lines when the question has no overlap', async () => {
    const question = 'zzz nonoverlap qqqq';
    const context = contextFor(question);
    const built = buildPrompt({ mode: 'ask', question, context });

    const result = await mockProvider.ask(built, context, metaFor('ask', question));
    expect(result.text).toContain('[0:26]'); // last cue's timestamp
  });

  it('recap: prefaces with the offline-demo label and stride-samples across the context', async () => {
    const question = 'Catch me up on what has happened so far.';
    const context = contextFor(question);
    const built = buildPrompt({ mode: 'recap', question, context });

    const result = await mockProvider.ask(built, context, metaFor('recap', question));
    expect(result.text.startsWith('Offline demo mode — key lines so far:')).toBe(true);
    // Should include something from near the start and near the end (stride sample).
    expect(result.text).toContain('[0:01]');
    expect(result.text).toContain('[0:26]');
  });

  it('who: lists named characters with their first-heard timestamp', async () => {
    const question = "Who's who so far?";
    const context = contextFor(question);
    const built = buildPrompt({ mode: 'who', question, context });

    const result = await mockProvider.ask(built, context, metaFor('who', question));
    expect(result.text.startsWith('Named so far:')).toBe(true);
    expect(result.text).toContain('Alice');
    expect(result.text).toContain('Bob');
  });

  it('scene: returns the last three lines', async () => {
    const question = 'What just happened?';
    const context = contextFor(question);
    const built = buildPrompt({ mode: 'scene', question, context });

    const result = await mockProvider.ask(built, context, metaFor('scene', question));
    expect(result.text).toContain('[0:16]');
    expect(result.text).toContain('[0:26]');
    expect(result.text).not.toContain('[0:01]'); // only the last 3, not the first
  });

  it('askStream yields the same content as ask(), split into sentence-sized chunks', async () => {
    const question = "Who's who so far?";
    const context = contextFor(question);
    const built = buildPrompt({ mode: 'who', question, context });
    const meta = metaFor('who', question);

    const { text: whole } = await mockProvider.ask(built, context, meta);

    let streamed = '';
    for await (const chunk of mockProvider.askStream(built, context, meta)) {
      streamed += chunk;
    }
    expect(streamed.trim()).toBe(whole.trim());
  });
});
