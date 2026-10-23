import { describe, it, expect } from 'vitest';
import { makeTestApp } from './helpers.js';
import { isSafePosterFilename } from '../src/app.js';

describe('isSafePosterFilename', () => {
  it('accepts a plain filename with an allow-listed image extension', () => {
    expect(isSafePosterFilename('night-of-the-living-dead-1968.jpg')).toBe(true);
    expect(isSafePosterFilename('poster_1.png')).toBe(true);
    expect(isSafePosterFilename('a.webp')).toBe(true);
  });

  it('rejects path traversal and anything with a path separator', () => {
    expect(isSafePosterFilename('../secret.jpg')).toBe(false);
    expect(isSafePosterFilename('..%2f..%2fetc%2fpasswd.jpg')).toBe(false);
    expect(isSafePosterFilename('foo/bar.jpg')).toBe(false);
    expect(isSafePosterFilename('/etc/passwd.jpg')).toBe(false);
    expect(isSafePosterFilename('..jpg')).toBe(false);
  });

  it('rejects filenames with no/unlisted extension or a leading dot', () => {
    expect(isSafePosterFilename('poster')).toBe(false);
    expect(isSafePosterFilename('poster.gif')).toBe(false);
    expect(isSafePosterFilename('.hidden.jpg')).toBe(false);
    expect(isSafePosterFilename('poster.jpg.exe')).toBe(false);
  });
});

describe('GET /v1/posters/:file', () => {
  it('serves a poster from the content store with the right content-type', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/posters/test-poster.jpg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('404s for a poster filename that does not exist', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/posters/does-not-exist.jpg');
    expect(res.status).toBe(404);
  });

  it('400s a path-traversal-shaped filename before ever touching the content store', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/posters/' + encodeURIComponent('../titles.json'));
    expect(res.status).toBe(400);
  });

  it('400s a filename with an encoded slash', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/v1/posters/..%2f..%2ftitles.json');
    expect([400, 404]).toContain(res.status);
  });
});

describe('GET /v1/titles poster URL rewriting', () => {
  it('rewrites a relative poster path to an absolute /v1/posters/ URL based on the request origin', async () => {
    const { app } = makeTestApp();
    const res = await app.request('http://localhost/v1/titles');
    const [title] = (await res.json()) as any[];
    expect(title.poster).toBe('http://localhost/v1/posters/test-poster.jpg');
  });

  it('respects X-Forwarded-Proto and X-Forwarded-Host (API Gateway in front of Lambda)', async () => {
    const { app } = makeTestApp();
    const res = await app.request('http://internal-lambda-url/v1/titles', {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'api.contextcue.example'
      }
    });
    const [title] = (await res.json()) as any[];
    expect(title.poster).toBe('https://api.contextcue.example/v1/posters/test-poster.jpg');
  });

  it('leaves an already-absolute poster URL unchanged', async () => {
    const { app, deps } = makeTestApp();
    const original = deps.contentStore.getTitle.bind(deps.contentStore);
    deps.contentStore.getTitle = async (id: string) => {
      const title = await original(id);
      if (!title) return title;
      return { ...title, poster: 'https://cdn.example.com/poster.jpg' };
    };
    deps.contentStore.listTitles = async () => [await deps.contentStore.getTitle('demo-1')] as any;

    const res = await app.request('http://localhost/v1/titles');
    const [title] = (await res.json()) as any[];
    expect(title.poster).toBe('https://cdn.example.com/poster.jpg');
  });
});
