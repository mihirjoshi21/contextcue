import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, errorMessageFromBody, ApiError } from '../src/api.js';
import { ContextCueController, type ContextCueOptions } from '../src/controller.js';

interface Call { url: string; method: string; headers: Record<string, string>; body: any }

function fakeFetch(routes: (c: Call) => { status?: number; body?: any } | undefined) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: any = {}) => {
    const call: Call = { url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const r = routes(call) ?? { status: 404, body: { error: 'nope' } };
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body, text: async () => JSON.stringify(r.body ?? '') };
  });
  return { fn, calls };
}

const ANSWER = { answer: 'He is the sheriff.', mode: 'ask', citations: [{ startMs: 65_000, endMs: 67_000, text: 'I am the sheriff' }], safeUntilMs: 0, guard: { passed: true, flags: [] }, provider: 'mock', model: 'm', latencyMs: 1 };

function defaultRoutes(extra?: (c: Call) => any) {
  return (c: Call) => {
    const e = extra?.(c);
    if (e) return e;
    if (c.url.endsWith('/v1/sessions') && c.method === 'POST') return { body: { code: 'ABC123', tvToken: 'tok' } };
    if (c.url.includes('/v1/sessions/') && c.method === 'PUT') return { body: { code: 'ABC123', positionMs: 0, playing: true } };
    if (c.url.includes('/v1/sessions/') && c.method === 'GET') return { body: { code: 'ABC123', positionMs: 0, playing: true } };
    if (c.url.endsWith('/v1/ask')) return { body: ANSWER };
    if (c.url.endsWith('/v1/speak')) return { body: { audioBase64: 'QUJD', contentType: 'audio/mpeg' } };
    return undefined;
  };
}

describe('api client', () => {
  it('sends X-TV-Token on PUT and trims base url', async () => {
    const { fn, calls } = fakeFetch(defaultRoutes());
    const api = createApiClient({ apiBaseUrl: 'https://h.test/', fetch: fn });
    await api.updateSession('ABC123', 'tok', { positionMs: 5 });
    expect(calls[0].url).toBe('https://h.test/v1/sessions/ABC123');
    expect(calls[0].headers['X-TV-Token']).toBe('tok');
    expect(calls[0].method).toBe('PUT');
  });
  it('maps 403 to forbidden with server message', async () => {
    const { fn } = fakeFetch(() => ({ status: 403, body: { error: 'invalid or missing X-TV-Token' } }));
    const api = createApiClient({ apiBaseUrl: 'https://h.test', fetch: fn });
    await expect(api.updateSession('A', 'x', {})).rejects.toMatchObject({ kind: 'forbidden', status: 403, message: 'invalid or missing X-TV-Token' });
  });
  it('maps network failures', async () => {
    const api = createApiClient({ apiBaseUrl: 'https://h.test', fetch: async () => { throw new Error('offline'); } });
    const err = await api.ask({ titleId: 't', positionMs: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('network');
  });
  it('errorMessageFromBody falls back', () => {
    expect(errorMessageFromBody('', 500)).toMatch('500');
    expect(errorMessageFromBody('plain', 500)).toBe('plain');
  });
  it('encodes session codes', async () => {
    const { fn, calls } = fakeFetch(defaultRoutes());
    await createApiClient({ apiBaseUrl: 'https://h.test', fetch: fn }).getSession('a/b');
    expect(calls[0].url).toBe('https://h.test/v1/sessions/a%2Fb');
  });
});

describe('ContextCueController', () => {
  let position = 120_000;
  let playing = true;
  const base = (fetch: any, extra: Partial<ContextCueOptions> = {}): ContextCueOptions => ({
    apiBaseUrl: 'https://h.test',
    titleId: 'notld',
    getPositionMs: () => position,
    get isPlaying() { return playing; },
    fetch,
    ...extra,
  });
  const flush = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

  beforeEach(() => { vi.useFakeTimers(); position = 120_000; playing = true; });
  afterEach(() => { vi.useRealTimers(); });

  it('creates a session on start and exposes the code + companion url', async () => {
    const { fn } = fakeFetch(defaultRoutes());
    const c = new ContextCueController(base(fn));
    c.start();
    await flush(10);
    expect(c.getState().sessionCode).toBe('ABC123');
    expect(c.getState().companionUrl).toBe('https://h.test/companion/?code=ABC123');
    c.stop();
  });

  it('heartbeats every ~2s with token, title and position', async () => {
    const { fn, calls } = fakeFetch(defaultRoutes());
    const c = new ContextCueController(base(fn));
    c.start();
    await flush(10_000);
    const puts = calls.filter((x) => x.method === 'PUT');
    expect(puts.length).toBeGreaterThanOrEqual(4);
    expect(puts.length).toBeLessThanOrEqual(6);
    expect(puts[0].headers['X-TV-Token']).toBe('tok');
    expect(puts[0].body).toEqual({ titleId: 'notld', positionMs: 120_000, playing: true });
    c.stop();
  });

  it('sends a heartbeat promptly when playback pauses', async () => {
    const { fn, calls } = fakeFetch(defaultRoutes());
    const c = new ContextCueController(base(fn));
    c.start();
    await flush(2500);
    const before = calls.filter((x) => x.method === 'PUT').length;
    playing = false;
    await flush(500);
    const after = calls.filter((x) => x.method === 'PUT');
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].body.playing).toBe(false);
    c.stop();
  });

  it('recreates the session once after a 403', async () => {
    let created = 0;
    let putCount = 0;
    const { fn, calls } = fakeFetch((c) => {
      if (c.url.endsWith('/v1/sessions') && c.method === 'POST') { created++; return { body: { code: `C${created}`, tvToken: `t${created}` } }; }
      if (c.method === 'PUT') { putCount++; return putCount === 1 ? { status: 403, body: { error: 'x' } } : { body: {} }; }
      return { body: { code: 'x', positionMs: 0, playing: true } };
    });
    const c = new ContextCueController(base(fn));
    c.start();
    await flush(6000);
    expect(created).toBe(2);
    expect(c.getState().sessionCode).toBe('C2');
    expect(calls.some((x) => x.method === 'PUT' && x.headers['X-TV-Token'] === 't2')).toBe(true);
    c.stop();
  });

  it('retries session creation if the first attempt fails', async () => {
    let n = 0;
    const { fn } = fakeFetch((c) => (c.method === 'POST' && ++n === 1 ? { status: 500, body: {} } : defaultRoutes()(c)));
    const c = new ContextCueController(base(fn));
    c.start();
    await flush(5000);
    expect(c.getState().sessionCode).toBe('ABC123');
    c.stop();
  });

  it('open() pauses the host and freezes the spoiler ceiling; close() resumes', async () => {
    const { fn } = fakeFetch(defaultRoutes());
    const c = new ContextCueController(base(fn));
    const h = { onRequestPause: vi.fn(), onRequestResume: vi.fn(), onSeek: vi.fn() };
    c.setHandlers(h);
    c.open();
    position = 999_000;
    expect(c.getState()).toMatchObject({ open: true, positionMs: 120_000 });
    expect(h.onRequestPause).toHaveBeenCalledTimes(1);
    c.close();
    expect(h.onRequestResume).toHaveBeenCalledTimes(1);
  });

  it('does not resume if the host was already paused when opened', () => {
    playing = false;
    const { fn } = fakeFetch(defaultRoutes());
    const c = new ContextCueController(base(fn));
    const h = { onRequestPause: vi.fn(), onRequestResume: vi.fn() };
    c.setHandlers(h);
    c.open();
    c.close();
    expect(h.onRequestPause).not.toHaveBeenCalled();
    expect(h.onRequestResume).not.toHaveBeenCalled();
  });

  it('asks with the FROZEN position, mode, and session code', async () => {
    const { fn, calls } = fakeFetch(defaultRoutes());
    const c = new ContextCueController(base(fn));
    c.start();
    await flush(10);
    c.open();
    position = 500_000;
    c.askChip('recap');
    expect(c.getState().ask.status).toBe('loading');
    await flush(10);
    const ask = calls.find((x) => x.url.endsWith('/v1/ask'))!;
    expect(ask.body).toMatchObject({ titleId: 'notld', positionMs: 120_000, mode: 'recap', sessionCode: 'ABC123' });
    expect(c.getState().ask.status).toBe('loaded');
    c.stop();
  });

  it('typed questions are trimmed; blank ones ignored', async () => {
    const { fn, calls } = fakeFetch(defaultRoutes());
    const c = new ContextCueController(base(fn, { disableSession: true }));
    c.open();
    c.askQuestion('   ');
    c.askQuestion('  who is that?  ');
    await flush(10);
    const asks = calls.filter((x) => x.url.endsWith('/v1/ask'));
    expect(asks).toHaveLength(1);
    expect(asks[0].body).toMatchObject({ mode: 'ask', question: 'who is that?' });
    expect(asks[0].body.sessionCode).toBeUndefined();
  });

  it('surfaces ask errors and retry works', async () => {
    let fail = true;
    const { fn } = fakeFetch(defaultRoutes((c) => (c.url.endsWith('/v1/ask') && fail ? { status: 500, body: { error: 'model down' } } : undefined)));
    const c = new ContextCueController(base(fn, { disableSession: true }));
    c.open();
    c.askChip('why');
    await flush(10);
    expect(c.getState().ask).toMatchObject({ status: 'error', message: 'model down' });
    fail = false;
    c.retry();
    await flush(10);
    expect(c.getState().ask.status).toBe('loaded');
  });

  it('selecting a citation seeks to startMs-2000 and resumes', async () => {
    const { fn } = fakeFetch(defaultRoutes());
    const c = new ContextCueController(base(fn, { disableSession: true }));
    const h = { onSeek: vi.fn(), onRequestPause: vi.fn(), onRequestResume: vi.fn() };
    c.setHandlers(h);
    c.open();
    c.askChip('why');
    await flush(10);
    c.selectCitation(ANSWER.citations[0]);
    expect(h.onSeek).toHaveBeenCalledWith(63_000);
    expect(h.onRequestResume).toHaveBeenCalled();
    expect(c.getState().open).toBe(false);
  });

  it('back() is consumed only while open, and closes after unwinding', () => {
    const { fn } = fakeFetch(defaultRoutes());
    const c = new ContextCueController(base(fn, { disableSession: true }));
    expect(c.back()).toBe(false);
    c.open();
    c.showPhone();
    expect(c.back()).toBe(true);
    expect(c.getState().open).toBe(true);
    expect(c.back()).toBe(true);
    expect(c.getState().open).toBe(false);
  });

  it('shows a phone-asked sharedAnswer once, pausing the host', async () => {
    const shared = { id: 's1', question: 'Who is she?', answer: 'Barbra.', citations: [], mode: 'ask', createdAt: 1 };
    const { fn } = fakeFetch(defaultRoutes((c) => (c.method === 'GET' ? { body: { code: 'ABC123', positionMs: 0, playing: true, sharedAnswer: shared } } : undefined)));
    const c = new ContextCueController(base(fn));
    const h = { onRequestPause: vi.fn(), onRequestResume: vi.fn() };
    c.setHandlers(h);
    c.start();
    await flush(5000);
    const st = c.getState();
    expect(st.open).toBe(true);
    expect(st.ask).toMatchObject({ status: 'loaded', query: { source: 'phone', question: 'Who is she?' } });
    expect(h.onRequestPause).toHaveBeenCalledTimes(1);
    // user dismisses; the same sharedAnswer keeps being polled but must not reopen
    c.back();
    c.back();
    expect(c.getState().open).toBe(false);
    await flush(6000);
    expect(c.getState().open).toBe(false);
    c.stop();
  });

  it('read aloud calls speak then playAudio; hidden without playAudio', async () => {
    const play = vi.fn(async () => {});
    const { fn, calls } = fakeFetch(defaultRoutes());
    const c = new ContextCueController(base(fn, { disableSession: true, playAudio: play }));
    expect(c.getState().canReadAloud).toBe(true);
    c.open();
    c.askChip('why');
    await flush(10);
    await c.readAloud();
    expect(calls.find((x) => x.url.endsWith('/v1/speak'))!.body).toEqual({ text: 'He is the sheriff.' });
    expect(play).toHaveBeenCalledWith('QUJD', 'audio/mpeg');
    expect(c.getState().ttsPlaying).toBe(false);
    const c2 = new ContextCueController(base(fn, { disableSession: true }));
    expect(c2.getState().canReadAloud).toBe(false);
  });

  it('read aloud skips playback for empty (mock) audio', async () => {
    const play = vi.fn();
    const { fn } = fakeFetch(defaultRoutes((c) => (c.url.endsWith('/v1/speak') ? { body: { audioBase64: '', contentType: 'audio/mpeg', error: true } } : undefined)));
    const c = new ContextCueController(base(fn, { disableSession: true, playAudio: play }));
    c.open();
    c.askChip('why');
    await flush(10);
    await c.readAloud();
    expect(play).not.toHaveBeenCalled();
    expect(c.getState().ttsPlaying).toBe(false);
  });

  it('stopReadAloud calls stopAudio', async () => {
    const stopAudio = vi.fn();
    let release!: () => void;
    const play = () => new Promise<void>((r) => { release = r; });
    const { fn } = fakeFetch(defaultRoutes());
    const c = new ContextCueController(base(fn, { disableSession: true, playAudio: play, stopAudio }));
    c.open();
    c.askChip('why');
    await flush(10);
    void c.readAloud();
    await flush(10);
    expect(c.getState().ttsPlaying).toBe(true);
    c.stopReadAloud();
    expect(stopAudio).toHaveBeenCalled();
    expect(c.getState().ttsPlaying).toBe(false);
    release();
  });

  it('notifies subscribers and keeps snapshot identity when nothing changed', () => {
    const { fn } = fakeFetch(defaultRoutes());
    const c = new ContextCueController(base(fn, { disableSession: true }));
    const l = vi.fn();
    c.subscribe(l);
    const s0 = c.getState();
    c.setOptions(base(fn, { disableSession: true }));
    expect(c.getState()).toBe(s0);
    expect(l).not.toHaveBeenCalled();
    c.open();
    expect(l).toHaveBeenCalled();
  });

  it('stop() halts timers', async () => {
    const { fn, calls } = fakeFetch(defaultRoutes());
    const c = new ContextCueController(base(fn));
    c.start();
    await flush(3000);
    c.stop();
    const n = calls.length;
    await flush(10_000);
    expect(calls.length).toBe(n);
  });
});
