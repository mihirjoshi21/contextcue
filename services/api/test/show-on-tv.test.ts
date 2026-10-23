import { describe, it, expect } from 'vitest';
import { makeTestApp } from './helpers.js';

describe('"Show on TV" (showOnTv + sharedAnswer)', () => {
  it('POST /v1/ask with showOnTv stores a sharedAnswer on the session, visible via GET', async () => {
    const { app, deps } = makeTestApp();
    const session = await deps.sessionStore.create();
    await deps.sessionStore.update(session.code, { titleId: 'demo-1', positionMs: 20_000, playing: true });

    const askRes = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        titleId: 'demo-1',
        positionMs: 20_000,
        question: 'What has happened so far?',
        sessionCode: session.code,
        showOnTv: true
      })
    });
    expect(askRes.status).toBe(200);
    const askBody = (await askRes.json()) as any;

    const getRes = await app.request(`/v1/sessions/${session.code}`);
    expect(getRes.status).toBe(200);
    const state = (await getRes.json()) as any;

    expect(state.sharedAnswer).toBeDefined();
    expect(typeof state.sharedAnswer.id).toBe('string');
    expect(state.sharedAnswer.question).toBe('What has happened so far?');
    expect(state.sharedAnswer.answer).toBe(askBody.answer);
    expect(state.sharedAnswer.citations).toEqual(askBody.citations);
    expect(state.sharedAnswer.mode).toBe('ask');
    expect(typeof state.sharedAnswer.createdAt).toBe('number');
  });

  it('sharedAnswer also appears in the PUT response (full session state)', async () => {
    const { app, deps } = makeTestApp();
    const session = await deps.sessionStore.create();
    await deps.sessionStore.update(session.code, { titleId: 'demo-1', positionMs: 20_000, playing: true });

    await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        titleId: 'demo-1',
        positionMs: 20_000,
        question: 'What has happened so far?',
        sessionCode: session.code,
        showOnTv: true
      })
    });

    const putRes = await app.request(`/v1/sessions/${session.code}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-tv-token': session.tvToken },
      body: JSON.stringify({ positionMs: 21_000 })
    });
    expect(putRes.status).toBe(200);
    const updated = (await putRes.json()) as any;
    expect(updated.sharedAnswer).toBeDefined();
    expect(updated.sharedAnswer.question).toBe('What has happened so far?');
  });

  it('does not store a sharedAnswer when showOnTv is omitted/false', async () => {
    const { app, deps } = makeTestApp();
    const session = await deps.sessionStore.create();
    await deps.sessionStore.update(session.code, { titleId: 'demo-1', positionMs: 20_000, playing: true });

    await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        titleId: 'demo-1',
        positionMs: 20_000,
        question: 'What has happened so far?',
        sessionCode: session.code
      })
    });

    const state = (await (await app.request(`/v1/sessions/${session.code}`)).json()) as any;
    expect(state.sharedAnswer).toBeUndefined();
  });

  it('does nothing (no error) when showOnTv is true but no sessionCode is given', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        titleId: 'demo-1',
        positionMs: 20_000,
        question: 'What has happened so far?',
        showOnTv: true
      })
    });
    expect(res.status).toBe(200);
  });

  it('/v1/ask/stream also stores a sharedAnswer on its final done event', async () => {
    const { app, deps } = makeTestApp();
    const session = await deps.sessionStore.create();
    await deps.sessionStore.update(session.code, { titleId: 'demo-1', positionMs: 20_000, playing: true });

    const res = await app.request('/v1/ask/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        titleId: 'demo-1',
        positionMs: 20_000,
        question: 'What has happened so far?',
        sessionCode: session.code,
        showOnTv: true
      })
    });
    expect(res.status).toBe(200);
    await res.text(); // drain the SSE stream to completion

    const state = (await (await app.request(`/v1/sessions/${session.code}`)).json()) as any;
    expect(state.sharedAnswer).toBeDefined();
    expect(state.sharedAnswer.question).toBe('What has happened so far?');
  });
});

describe('GET /v1/titles pass-through fields', () => {
  it('passes through playbackStartMs and skipRanges when present, poster always', async () => {
    const { app, deps } = makeTestApp();
    const original = deps.contentStore.getTitle.bind(deps.contentStore);
    deps.contentStore.getTitle = async (id: string) => {
      const title = await original(id);
      if (!title) return title;
      return {
        ...title,
        poster: 'https://example.com/poster.jpg',
        playbackStartMs: 392_000,
        skipRanges: [{ startMs: 0, endMs: 392_000, label: 'host intro' }]
      };
    };
    deps.contentStore.listTitles = async () => [await deps.contentStore.getTitle('demo-1')] as any;

    const res = await app.request('/v1/titles');
    expect(res.status).toBe(200);
    const [title] = (await res.json()) as any[];
    expect(title.poster).toBe('https://example.com/poster.jpg');
    expect(title.playbackStartMs).toBe(392_000);
    expect(title.skipRanges).toEqual([{ startMs: 0, endMs: 392_000, label: 'host intro' }]);
  });
});
