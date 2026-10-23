import { describe, it, expect } from 'vitest';
import { makeTestApp } from './helpers.js';

describe('GET /v1/titles', () => {
  it('lists titles from the fixture content dir with the spec fields', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/titles');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    const [title] = body;
    expect(title).toMatchObject({
      id: 'demo-1',
      title: 'Test Movie',
      durationMs: 600_000,
      videoUrl: 'https://example.com/video.mp4',
      hasSubtitles: true,
      license: 'test-fixture-only'
    });
  });
});

describe('GET /health', () => {
  it('reports ok and the configured provider', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ ok: true, provider: 'mock' });
  });
});

describe('GET /v1/titles/:id/characters', () => {
  it('returns only characters seen up to positionMs', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/titles/demo-1/characters?positionMs=20000');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
    const names = body.map((c: { name: string }) => c.name);
    // Carol is only ever mentioned in the future cues (300s/310s), so she must not appear yet.
    expect(names).not.toContain('Carol');
  });

  it('404s for an unknown title', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/titles/does-not-exist/characters?positionMs=1000');
    expect(res.status).toBe(404);
  });
});
