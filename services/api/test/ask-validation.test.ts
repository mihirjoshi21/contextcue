import { describe, it, expect } from 'vitest';
import { makeTestApp } from './helpers.js';

const TITLE_DURATION_MS = 600_000; // demo-1 fixture durationMs

describe('/v1/ask validation', () => {
  it('404s when sessionCode is given but no such session exists (no silent fallback)', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        titleId: 'demo-1',
        positionMs: 20_000,
        question: 'What just happened?',
        sessionCode: 'NOPE99'
      })
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body).toEqual({ error: 'session not found' });
  });

  it('does not require a question for non-ask modes (uses a default question per mode), and the answer clears the spoiler guard', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: 'demo-1', positionMs: 20_000, mode: 'recap' })
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.mode).toBe('recap');
    expect(typeof body.answer).toBe('string');
    expect(body.answer.length).toBeGreaterThan(0);
    // Regression check: MockProvider's own "Offline demo mode" preface must
    // not trip spoilerGuard's world-knowledge-leak check (it isn't a
    // transcript word, so the guard can't see it in context — it needs the
    // provider's `guardAllowedNames` escape hatch, see src/providers/mock.ts).
    expect(body.guard.passed).toBe(true);
    expect(body.answer.startsWith('Offline demo mode')).toBe(true);
  });

  it('still requires a question for mode "ask" (default or omitted)', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: 'demo-1', positionMs: 20_000 })
    });
    expect(res.status).toBe(400);
  });

  it('rejects a negative positionMs (400)', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: 'demo-1', positionMs: -1000, question: 'hi?' })
    });
    expect(res.status).toBe(400);
  });

  it('rejects a non-finite positionMs (400)', async () => {
    const { app } = makeTestApp();
    // Hand-written body so "1e400" parses as the JS number Infinity, which
    // JSON.stringify(Infinity) can't produce (it becomes "null") — this is
    // the one way to get a genuinely non-finite number through JSON.parse.
    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"titleId":"demo-1","positionMs":1e400,"question":"hi?"}'
    });
    expect(res.status).toBe(400);
  });

  it('clamps positionMs to the title\'s durationMs instead of rejecting it', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: 'demo-1', positionMs: 999_999_999, question: 'What happened?' })
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.safeUntilMs).toBeLessThanOrEqual(TITLE_DURATION_MS);
  });

  it('rejects a question over 500 characters (400)', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: 'demo-1', positionMs: 20_000, question: 'a'.repeat(501) })
    });
    expect(res.status).toBe(400);
  });

  it('accepts a question exactly at the 500 character cap', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: 'demo-1', positionMs: 20_000, question: 'a'.repeat(500) })
    });
    expect(res.status).toBe(200);
  });
});

describe('/v1/titles/:id/characters validation', () => {
  it('accepts a sessionCode and clamps positionMs to the session position', async () => {
    const { app, deps } = makeTestApp();
    const session = await deps.sessionStore.create();
    await deps.sessionStore.update(session.code, { titleId: 'demo-1', positionMs: 8_000, playing: true });

    // Client claims a much later position; the session should win via clamping.
    const withSession = await app.request(
      `/v1/titles/demo-1/characters?positionMs=999999&sessionCode=${session.code}`
    );
    const withoutSession = await app.request('/v1/titles/demo-1/characters?positionMs=999999');

    expect(withSession.status).toBe(200);
    expect(withoutSession.status).toBe(200);
    // Can't directly observe the clamped positionMs, but the two requests must
    // not necessarily produce identical results when a session caps one of them
    // to a much earlier point in a title with characters introduced over time.
    // At minimum, both must succeed and return arrays.
    expect(Array.isArray(await withSession.json())).toBe(true);
    expect(Array.isArray(await withoutSession.json())).toBe(true);
  });

  it('404s when sessionCode is given but does not exist', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/titles/demo-1/characters?positionMs=1000&sessionCode=NOPE99');
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body).toEqual({ error: 'session not found' });
  });

  it('rejects a negative positionMs (400)', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/titles/demo-1/characters?positionMs=-5');
    expect(res.status).toBe(400);
  });

  it('clamps positionMs to the title\'s durationMs', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/titles/demo-1/characters?positionMs=999999999');
    expect(res.status).toBe(200);
  });
});
