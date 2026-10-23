import { describe, it, expect } from 'vitest';
import { makeTestApp, makeTestDeps, stubProvider } from './helpers.js';

const FUTURE_LINE = 'SECRET_FUTURE_LINE';

describe('POST /v1/ask — spoiler safety', () => {
  it('never returns the future line when asking early in the title (mock provider)', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        titleId: 'demo-1',
        positionMs: 20_000, // just after cue 4, well before the 5:00 future cues
        question: 'What has happened so far?'
      })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.answer).not.toContain(FUTURE_LINE);
    expect(body.safeUntilMs).toBeLessThanOrEqual(20_000);
    for (const citation of body.citations) {
      expect(citation.startMs).toBeLessThanOrEqual(20_000);
      expect(citation.text).not.toContain(FUTURE_LINE);
    }
  });

  it('sanitizes a leaking model answer via the spoiler guard, even if the model tries to cite the future', async () => {
    // Simulate a misbehaving model that quotes a future line and cites a future timestamp.
    const leaking = stubProvider(
      `Well, it turns out ${FUTURE_LINE} Carol was the killer all along [05:00].`
    );
    const { app } = makeTestApp({ provider: leaking });

    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        titleId: 'demo-1',
        positionMs: 20_000,
        question: 'What happens?'
      })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.answer).not.toContain(FUTURE_LINE);
    expect(body.guard.passed).toBe(false);
    for (const citation of body.citations) {
      expect(citation.startMs).toBeLessThanOrEqual(20_000);
    }
  });

  it('enforces the session min(client, session) position rule so a companion can never ask past the TV', async () => {
    const { app, deps } = makeTestApp();
    const session = await deps.sessionStore.create();
    await deps.sessionStore.update(session.code, { titleId: 'demo-1', positionMs: 10_000, playing: true });

    // Companion sends a much later client position than the TV's actual position.
    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        titleId: 'demo-1',
        positionMs: 500_000, // would otherwise reach the SECRET_FUTURE_LINE cues at 300s/310s
        question: 'What just happened?',
        sessionCode: session.code
      })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    // The effective position must be clamped to the session's 10s, not the client's 500s.
    expect(body.safeUntilMs).toBeLessThanOrEqual(10_000);
    expect(body.answer).not.toContain(FUTURE_LINE);
    for (const citation of body.citations) {
      expect(citation.startMs).toBeLessThanOrEqual(10_000);
    }
  });

  it('returns 400 when required fields are missing', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: 'demo-1' })
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown title', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: 'nope', positionMs: 1000, question: 'hi?' })
    });
    expect(res.status).toBe(404);
  });
});

describe('provider error fallback', () => {
  it('returns the provider fallback text untouched (no guard mangling, no citations)', async () => {
    const fallback = "I couldn't reach the AI model just now. Please try again in a few seconds.";
    const failing = { ...stubProvider(fallback), name: 'bedrock' as const, ask: async () => ({ text: fallback, model: 'm', error: true }) };
    const { app } = makeTestApp({ provider: failing });
    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: 'demo-1', positionMs: 20_000, question: 'Who is that?' })
    });
    const body = (await res.json()) as any;
    expect(body.answer).toBe(fallback);
    expect(body.citations).toEqual([]);
    expect(body.guard.flags).toContain('provider-error');
  });
});

describe('guard allows names the viewer typed', () => {
  it('does not strip a sentence that echoes a name from the question', async () => {
    const { app } = makeTestApp({ provider: stubProvider('Zelda has not been mentioned in the story so far.') });
    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: 'demo-1', positionMs: 20_000, question: "What's wrong with Zelda?" })
    });
    const body = (await res.json()) as any;
    expect(body.answer).toBe('Zelda has not been mentioned in the story so far.');
    expect(body.guard.passed).toBe(true);
  });
});
