import { describe, it, expect } from 'vitest';
import { makeTestApp, stubProvider } from './helpers.js';

const FUTURE_LINE = 'SECRET_FUTURE_LINE';

/** Minimal SSE parser: turns a raw SSE body into an array of {event, data}. */
function parseSSE(body: string): { event?: string; data: string }[] {
  const events: { event?: string; data: string }[] = [];
  for (const block of body.split('\n\n')) {
    if (!block.trim()) continue;
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length > 0) events.push({ event, data: dataLines.join('\n') });
  }
  return events;
}

describe('POST /v1/ask/stream (SSE)', () => {
  it('streams sentence events followed by a done event, never leaking the future line', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/ask/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: 'demo-1', positionMs: 20_000, question: 'What has happened so far?' })
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    const events = parseSSE(body);

    expect(events.length).toBeGreaterThan(0);
    const doneEvent = events.find((e) => e.event === 'done');
    expect(doneEvent).toBeDefined();

    const done = JSON.parse(doneEvent!.data);
    expect(done.type).toBe('done');
    expect(done.answer).not.toContain(FUTURE_LINE);
    expect(done.safeUntilMs).toBeLessThanOrEqual(20_000);
    for (const citation of done.citations) {
      expect(citation.startMs).toBeLessThanOrEqual(20_000);
    }

    for (const e of events) {
      if (e.event === 'sentence') {
        const parsed = JSON.parse(e.data);
        expect(parsed.text).not.toContain(FUTURE_LINE);
      }
    }
  });

  it('never emits a sentence the spoiler guard flags, even mid-stream', async () => {
    // A provider that streams two sentences: a safe one, then one that leaks
    // a future timestamp citation — the second must never appear as a
    // `sentence` event, only folded into the guard's flags on `done`.
    const leaking = stubProvider('');
    leaking.askStream = async function* () {
      yield 'This is fine so far. ';
      yield 'But it turns out the ending is revealed here [05:00]. ';
    };

    const { app } = makeTestApp({ provider: leaking });
    const res = await app.request('/v1/ask/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: 'demo-1', positionMs: 20_000, question: 'What happens?' })
    });

    const events = parseSSE(await res.text());
    const sentenceTexts = events.filter((e) => e.event === 'sentence').map((e) => JSON.parse(e.data).text);

    expect(sentenceTexts.some((t) => t.includes('This is fine so far'))).toBe(true);
    expect(sentenceTexts.some((t) => t.includes('ending is revealed'))).toBe(false);

    const done = JSON.parse(events.find((e) => e.event === 'done')!.data);
    expect(done.guard.passed).toBe(false);
    expect(done.guard.flags.length).toBeGreaterThan(0);
  });

  it('applies the same validation as /v1/ask (e.g. unknown session -> 404)', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/ask/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        titleId: 'demo-1',
        positionMs: 1000,
        question: 'hi?',
        sessionCode: 'NOPE99'
      })
    });
    expect(res.status).toBe(404);
  });
});

describe('streaming preserves line breaks', () => {
  it('keeps newlines between lines in sentence events and the final answer', async () => {
    const provider = stubProvider('');
    provider.askStream = async function* () {
      yield 'Alice — a woman\nBob — a man\n';
    };
    const { app } = makeTestApp({ provider });
    const res = await app.request('/v1/ask/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: 'demo-1', positionMs: 20_000, question: 'who?' })
    });
    const events = parseSSE(await res.text());
    const done = JSON.parse(events.find((e) => e.event === 'done')!.data);
    expect(done.answer).toBe('Alice — a woman\nBob — a man');
  });
});
