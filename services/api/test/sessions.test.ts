import { describe, it, expect } from 'vitest';
import { makeTestApp } from './helpers.js';

describe('Session CRUD', () => {
  it('creates a 6-char, unambiguous-charset session code (plus a tvToken for PUT auth)', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/sessions', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof body.code).toBe('string');
    expect(body.code).toHaveLength(6);
    expect(body.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(typeof body.tvToken).toBe('string');
    expect(body.tvToken.length).toBeGreaterThan(0);
  });

  it('creates, updates, and fetches a session', async () => {
    const { app } = makeTestApp();

    const created = (await (await app.request('/v1/sessions', { method: 'POST' })).json()) as any;
    const { code, tvToken } = created;

    const putRes = await app.request(`/v1/sessions/${code}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-tv-token': tvToken },
      body: JSON.stringify({ titleId: 'demo-1', positionMs: 12_345, playing: true })
    });
    expect(putRes.status).toBe(200);
    const updated = (await putRes.json()) as any;
    expect(updated).toMatchObject({ code, titleId: 'demo-1', positionMs: 12_345, playing: true });
    expect(updated.tvTokenHash).toBeUndefined(); // never leaked to clients

    const getRes = await app.request(`/v1/sessions/${code}`);
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as any;
    expect(fetched).toMatchObject({ code, titleId: 'demo-1', positionMs: 12_345, playing: true });
  });

  it('partial PUT does not clobber unspecified fields', async () => {
    const { app } = makeTestApp();
    const { code, tvToken } = (await (await app.request('/v1/sessions', { method: 'POST' })).json()) as any;

    await app.request(`/v1/sessions/${code}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-tv-token': tvToken },
      body: JSON.stringify({ titleId: 'demo-1', positionMs: 5000, playing: true })
    });

    const putRes = await app.request(`/v1/sessions/${code}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-tv-token': tvToken },
      body: JSON.stringify({ positionMs: 6000 })
    });
    const updated = (await putRes.json()) as any;
    expect(updated).toMatchObject({ titleId: 'demo-1', positionMs: 6000, playing: true });
  });

  it('403s a PUT with a missing or wrong X-TV-Token', async () => {
    const { app } = makeTestApp();
    const { code } = (await (await app.request('/v1/sessions', { method: 'POST' })).json()) as any;

    const noToken = await app.request(`/v1/sessions/${code}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ positionMs: 1000 })
    });
    expect(noToken.status).toBe(403);

    const wrongToken = await app.request(`/v1/sessions/${code}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-tv-token': 'not-the-right-token' },
      body: JSON.stringify({ positionMs: 1000 })
    });
    expect(wrongToken.status).toBe(403);
  });

  it('404s for GET/PUT on an unknown session code', async () => {
    const { app } = makeTestApp();
    const getRes = await app.request('/v1/sessions/ZZZZZZ');
    expect(getRes.status).toBe(404);

    const putRes = await app.request('/v1/sessions/ZZZZZZ', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ positionMs: 1 })
    });
    expect(putRes.status).toBe(404);
  });
});
