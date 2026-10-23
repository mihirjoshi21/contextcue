import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  ApiError,
  ask,
  askStream,
  createSession,
  createSseParser,
  formatTimestamp,
  getCharacters,
  getSession,
  getTitles,
  isValidSessionCode,
  normalizeSessionCode,
  speak,
  StreamUnsupportedError,
} from './api';

function jsonResponse(body: unknown, init?: Partial<{ ok: boolean; status: number }>) {
  const ok = init?.ok ?? true;
  const status = init?.status ?? (ok ? 200 : 500);
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('normalizeSessionCode', () => {
  it('uppercases lowercase input', () => {
    expect(normalizeSessionCode('ab12cd')).toBe('AB12CD');
  });

  it('strips whitespace and punctuation from pasted text', () => {
    expect(normalizeSessionCode(' ab-12 cd ')).toBe('AB12CD');
  });

  it('strips non-alphanumeric separators from a stray paste', () => {
    expect(normalizeSessionCode('ZK-4T-9Q')).toBe('ZK4T9Q');
  });

  it('truncates to 6 characters', () => {
    expect(normalizeSessionCode('ABCDEFGH')).toBe('ABCDEF');
  });

  it('leaves a clean 6-char code untouched (besides casing)', () => {
    expect(normalizeSessionCode('zk4t9q')).toBe('ZK4T9Q');
  });
});

describe('isValidSessionCode', () => {
  it('accepts exactly 6 uppercase alphanumeric chars', () => {
    expect(isValidSessionCode('ZK4T9Q')).toBe(true);
  });

  it('rejects short, long, or lowercase codes', () => {
    expect(isValidSessionCode('ZK4T9')).toBe(false);
    expect(isValidSessionCode('ZK4T9QQ')).toBe(false);
    expect(isValidSessionCode('zk4t9q')).toBe(false);
  });
});

describe('formatTimestamp', () => {
  it('formats sub-hour durations as m:ss', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(724000)).toBe('12:04');
  });

  it('formats hour-plus durations as h:mm:ss', () => {
    expect(formatTimestamp(3723000)).toBe('1:02:03');
  });
});

describe('api client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getTitles calls GET /v1/titles and returns parsed JSON', async () => {
    const titles = [
      {
        id: 't1',
        title: 'Example',
        durationMs: 100,
        videoUrl: 'x.mp4',
        hasSubtitles: true,
        license: 'demo',
      },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(titles));

    const result = await getTitles();

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/titles',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(result).toEqual(titles);
  });

  it('createSession posts to /v1/sessions', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'ZK4T9Q' }));

    const result = await createSession();

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/sessions',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toEqual({ code: 'ZK4T9Q' });
  });

  it('getSession GETs /v1/sessions/:code with the code encoded', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'ZK4T9Q', titleId: 't1', positionMs: 724000, playing: true }),
    );

    const result = await getSession('ZK4T9Q');

    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/ZK4T9Q', expect.anything());
    expect(result.positionMs).toBe(724000);
  });

  it('ask posts the question and returns the answer with citations', async () => {
    const response = {
      answer: 'She is the detective.',
      mode: 'who' as const,
      citations: [{ startMs: 60000, endMs: 65000, text: 'line' }],
      safeUntilMs: 724000,
      guard: { passed: true, flags: [] },
      provider: 'mock',
      model: 'mock',
      latencyMs: 12,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(response));

    const result = await ask({
      titleId: 't1',
      positionMs: 724000,
      question: 'Who is that?',
      mode: 'who',
      sessionCode: 'ZK4T9Q',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/ask',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          titleId: 't1',
          positionMs: 724000,
          question: 'Who is that?',
          mode: 'who',
          sessionCode: 'ZK4T9Q',
        }),
      }),
    );
    expect(result).toEqual(response);
  });

  it('speak posts text and returns base64 audio', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ audioBase64: 'abc==', contentType: 'audio/mpeg' }),
    );

    const result = await speak({ text: 'hello' });

    expect(result.contentType).toBe('audio/mpeg');
  });

  it('getCharacters GETs with a positionMs query param', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ name: 'Ana', firstSeenMs: 1000, mentions: 3 }]),
    );

    const result = await getCharacters('t1', 724000);

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/titles/t1/characters?positionMs=724000',
      expect.anything(),
    );
    expect(result[0].name).toBe('Ana');
  });

  it('getCharacters includes sessionCode in the query string when provided', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await getCharacters('t1', 724000, 'ZK4T9Q');

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/titles/t1/characters?positionMs=724000&sessionCode=ZK4T9Q',
      expect.anything(),
    );
  });

  it('ask includes showOnTv when set', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        answer: 'x',
        mode: 'ask',
        citations: [],
        safeUntilMs: 0,
        guard: { passed: true, flags: [] },
        provider: 'mock',
        model: 'mock',
        latencyMs: 1,
      }),
    );

    await ask({ titleId: 't1', positionMs: 0, question: 'q', showOnTv: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ showOnTv: true });
  });

  it('throws ApiError with kind "not-found" on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no such session' }, { ok: false, status: 404 }));

    await expect(getSession('NOPE00')).rejects.toMatchObject({ kind: 'not-found', status: 404 });
  });

  it('throws ApiError with kind "server" on 5xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));

    await expect(getTitles()).rejects.toMatchObject({ kind: 'server', status: 500 });
  });

  it('throws ApiError with kind "network" when fetch rejects (API down)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(getTitles()).rejects.toBeInstanceOf(ApiError);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(getTitles()).rejects.toMatchObject({ kind: 'network' });
  });
});

const SSE_BODY =
  'event: sentence\n' +
  'data: {"text":"Hello."}\n' +
  '\n' +
  'event: sentence\n' +
  'data: {"text":"World."}\n' +
  '\n' +
  'event: done\n' +
  'data: {"answer":"Hello. World.","citations":[{"startMs":1000,"endMs":2000,"text":"hi"}],"guard":{"passed":true,"flags":[]},"latencyMs":42,"safeUntilMs":5000}\n' +
  '\n';

/** Splits `text` into `count` chunks at arbitrary (possibly mid-line/mid-event) offsets. */
function splitInto(text: string, count: number): string[] {
  const size = Math.ceil(text.length / count);
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

describe('createSseParser', () => {
  it('parses a well-formed single push', () => {
    const parser = createSseParser();
    const events = parser.push(SSE_BODY);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ event: 'sentence', data: '{"text":"Hello."}' });
    expect(events[2].event).toBe('done');
  });

  it('reassembles events correctly no matter how the input is chunked mid-event', () => {
    for (const chunkCount of [1, 2, 3, 5, 7, 13, 40]) {
      const parser = createSseParser();
      const collected: { event: string; data: string }[] = [];
      for (const chunk of splitInto(SSE_BODY, chunkCount)) {
        collected.push(...parser.push(chunk));
      }
      expect(collected.map((e) => e.event)).toEqual(['sentence', 'sentence', 'done']);
      expect(JSON.parse(collected[0].data)).toEqual({ text: 'Hello.' });
      expect(JSON.parse(collected[1].data)).toEqual({ text: 'World.' });
      expect(JSON.parse(collected[2].data)).toMatchObject({ answer: 'Hello. World.' });
    }
  });

  it('handles a chunk boundary landing exactly on the blank-line separator', () => {
    const sepIndex = SSE_BODY.indexOf('\n\n') + 1; // split between the two \n of "\n\n"
    const parser = createSseParser();
    const events = [...parser.push(SSE_BODY.slice(0, sepIndex)), ...parser.push(SSE_BODY.slice(sepIndex))];
    expect(events).toHaveLength(3);
  });

  it('ignores comment lines and carries no state across unrelated pushes once flushed', () => {
    const parser = createSseParser();
    const events = parser.push(':keep-alive\n\nevent: sentence\ndata: {"text":"hi"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ event: 'sentence', data: '{"text":"hi"}' });
  });
});

describe('askStream', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function streamResponse(text: string, chunkCount: number, init?: { ok?: boolean; status?: number }) {
    const encoder = new TextEncoder();
    const chunks = splitInto(text, chunkCount);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return {
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      body,
      text: async () => '',
      json: async () => ({}),
    } as unknown as Response;
  }

  it('yields sentence events then a done event, surviving chunk splits', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(SSE_BODY, 7));

    const events = [];
    for await (const evt of askStream({ titleId: 't1', positionMs: 5000, question: 'catch me up' })) {
      events.push(evt);
    }

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: 'sentence', text: 'Hello.' });
    expect(events[1]).toEqual({ type: 'sentence', text: 'World.' });
    expect(events[2]).toMatchObject({ type: 'done', answer: 'Hello. World.', latencyMs: 42, safeUntilMs: 5000 });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/v1/ask/stream');
  });

  it('yields a typed `error` event for an `error` SSE frame (caller decides how to react)', async () => {
    const body = 'event: error\ndata: {"message":"guard failed"}\n\n';
    fetchMock.mockResolvedValueOnce(streamResponse(body, 3));

    const events = [];
    for await (const evt of askStream({ titleId: 't1', positionMs: 0, question: 'q' })) {
      events.push(evt);
    }

    expect(events).toEqual([{ type: 'error', message: 'guard failed' }]);
  });

  it('throws StreamUnsupportedError on a 404 so callers can fall back to ask()', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, body: null, text: async () => '', json: async () => ({}) });

    const iterate = async () => {
      for await (const _evt of askStream({ titleId: 't1', positionMs: 0, question: 'q' })) {
        void _evt;
      }
    };

    await expect(iterate()).rejects.toBeInstanceOf(StreamUnsupportedError);
  });
});
