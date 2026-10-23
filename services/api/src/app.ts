import type { Context } from 'hono';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { extractCharacters } from '@contextcue/core';
import { answerQuestion, answerQuestionStream, resolveAskRequest, type AskRequestBody } from './ask.js';
import { filterSkipRanges } from './skip-ranges.js';
import { verifyTvToken } from './tv-token.js';
import { mountMcp } from './mcp/mount.js';
import type { AiProvider, ContentStore, SessionState, SessionStore, Speech, TitleListItem } from './types.js';

/** Strips the internal `tvTokenHash` field before a `SessionState` ever
 * reaches a client — every GET/PUT session response goes through this. */
function toPublicSession(session: SessionState): Omit<SessionState, 'tvTokenHash'> {
  const { tvTokenHash: _tvTokenHash, ...pub } = session;
  return pub;
}

/**
 * Allow-listed poster filename shape for `GET /v1/posters/:file`: letters/digits/`-`/`_`
 * then exactly one recognized image extension. No `.`/`/` anywhere else, so nothing
 * resembling `..`, an absolute path, or a nested path segment can ever match — this is
 * the first line of defense against path traversal (content stores also re-validate
 * defensively; see FsContentStore.getPoster).
 */
const SAFE_POSTER_FILENAME = /^[A-Za-z0-9][A-Za-z0-9_-]*\.(jpg|jpeg|png|webp)$/;

export function isSafePosterFilename(name: string): boolean {
  return SAFE_POSTER_FILENAME.test(name);
}

/**
 * Resolves the public origin a request came in on, preferring
 * `X-Forwarded-Proto`/`X-Forwarded-Host` (set by API Gateway/any reverse proxy) over
 * the raw request URL (which, behind Lambda/API Gateway, is an internal one) — this is
 * what lets `GET /v1/titles` turn a relative poster path into an absolute URL that
 * actually resolves for whoever's asking, in both local dev and deployed AWS.
 */
function resolveOrigin(c: Context): string {
  const url = new URL(c.req.url);
  const forwardedHost = c.req.header('x-forwarded-host') ?? c.req.header('host');
  const host = (forwardedHost ?? url.host).split(',')[0]?.trim() || url.host;
  const forwardedProto = c.req.header('x-forwarded-proto');
  const proto = (forwardedProto?.split(',')[0]?.trim() || url.protocol.replace(':', '')) as string;
  return `${proto}://${host}`;
}

/** Bare filename a relative poster path (e.g. "posters/foo.jpg") maps to under
 * `GET /v1/posters/:file`, which only ever takes a flat filename. */
function posterFilename(relativePath: string): string {
  const parts = relativePath.split('/');
  return parts[parts.length - 1] ?? relativePath;
}

/** Rewrites a title's `poster` field into an absolute URL clients can always load:
 * an already-absolute URL (http/https) is passed through unchanged (e.g. a title that
 * still points at an external host); a relative one (our own locally-hosted posters,
 * `"posters/xxx.jpg"`) becomes `${origin}/v1/posters/xxx.jpg`. */
function resolvePosterUrl(poster: string | undefined, origin: string): string | undefined {
  if (!poster) return poster;
  if (/^https?:\/\//i.test(poster)) return poster;
  return `${origin}/v1/posters/${encodeURIComponent(posterFilename(poster))}`;
}

export interface AppDeps {
  provider: AiProvider;
  sessionStore: SessionStore;
  contentStore: ContentStore;
  speech: Speech;
}

interface SpeakBody {
  text?: string;
  voice?: string;
}

interface SessionPutBody {
  titleId?: string;
  positionMs?: number;
  playing?: boolean;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.use('*', cors());

  app.get('/health', (c) => c.json({ ok: true, provider: deps.provider.name }));

  app.get('/v1/titles', async (c) => {
    const titles = await deps.contentStore.listTitles();
    const origin = resolveOrigin(c);
    const items: TitleListItem[] = titles.map((t) => ({
      id: t.id,
      title: t.title,
      durationMs: t.durationMs,
      poster: resolvePosterUrl(t.poster, origin),
      videoUrl: t.videoUrl,
      hasSubtitles: Boolean(t.subtitles),
      license: t.license,
      playbackStartMs: t.playbackStartMs,
      skipRanges: t.skipRanges
    }));
    return c.json(items);
  });

  // Serves a locally-hosted poster image (see resolvePosterUrl above): FsContentStore
  // reads it off disk, S3ContentStore streams it straight from the content bucket.
  // `:file` is validated against an allow-list before it ever reaches the content
  // store, which defends independently anyway (path traversal, in particular).
  app.get('/v1/posters/:file', async (c) => {
    const file = c.req.param('file');
    if (!isSafePosterFilename(file)) return c.json({ error: 'invalid poster filename' }, 400);
    const asset = await deps.contentStore.getPoster(file);
    if (!asset) return c.notFound();
    return new Response(asset.body as never, {
      status: 200,
      headers: {
        'Content-Type': asset.contentType,
        'Cache-Control': 'public, max-age=86400, immutable'
      }
    });
  });

  app.get('/v1/titles/:id/characters', async (c) => {
    const id = c.req.param('id');
    const sessionCode = c.req.query('sessionCode');
    const positionMsParam = c.req.query('positionMs');

    let positionMs = positionMsParam !== undefined ? Number(positionMsParam) : 0;
    if (!Number.isFinite(positionMs) || positionMs < 0) {
      return c.json({ error: 'positionMs must be a non-negative finite number' }, 400);
    }

    // When a session is given, ITS titleId wins over the URL's :id — a
    // session can only ever answer for what it's actually watching. A
    // mismatch is a conflict (409), not silently ignored or merged; no
    // titleId yet on the session means nothing has been watched at all.
    if (sessionCode) {
      const session = await deps.sessionStore.get(sessionCode);
      if (!session) return c.json({ error: 'session not found' }, 404);
      if (!session.titleId) return c.json([]);
      if (session.titleId !== id) {
        return c.json({ error: 'title does not match session' }, 409);
      }
      positionMs = Math.min(positionMs, session.positionMs);
    }

    const title = await deps.contentStore.getTitle(id);
    if (!title) return c.json({ error: 'title not found' }, 404);
    positionMs = Math.min(positionMs, title.durationMs);

    const cues = await deps.contentStore.getCues(id);
    const watchedCues = filterSkipRanges(cues, title.skipRanges);
    const characters = extractCharacters(watchedCues, positionMs);
    return c.json(characters);
  });

  app.post('/v1/ask', async (c) => {
    const body = await c.req.json<AskRequestBody>().catch(() => ({}) as AskRequestBody);
    const resolved = await resolveAskRequest(deps, body);
    if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);

    const response = await answerQuestion(deps, resolved);
    return c.json(response);
  });

  // SSE streaming counterpart of /v1/ask: emits `sentence` events as each one
  // clears the spoiler guard, then a final `done` event with the full
  // response shape (citations/guard/latency). /v1/ask itself is unchanged.
  app.post('/v1/ask/stream', async (c) => {
    const body = await c.req.json<AskRequestBody>().catch(() => ({}) as AskRequestBody);
    const resolved = await resolveAskRequest(deps, body);
    if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);

    return streamSSE(c, async (stream) => {
      for await (const event of answerQuestionStream(deps, resolved)) {
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      }
    });
  });

  app.post('/v1/speak', async (c) => {
    const body = await c.req.json<SpeakBody>().catch(() => ({}) as SpeakBody);
    if (!body.text) return c.json({ error: 'text is required' }, 400);
    const result = await deps.speech.synthesize(body.text, body.voice);
    return c.json(result);
  });

  app.post('/v1/sessions', async (c) => {
    const session = await deps.sessionStore.create();
    // The join `code` stays shareable (GET/ask). `tvToken` is returned ONLY
    // here, ONLY now — it's never persisted in plaintext and never appears
    // in any other response (see toPublicSession).
    return c.json({ code: session.code, tvToken: session.tvToken });
  });

  app.put('/v1/sessions/:code', async (c) => {
    const code = c.req.param('code');
    const existing = await deps.sessionStore.get(code);
    if (!existing) return c.json({ error: 'session not found' }, 404);

    if (!verifyTvToken(existing.tvTokenHash, c.req.header('x-tv-token'))) {
      return c.json({ error: 'invalid or missing X-TV-Token' }, 403);
    }

    const body = await c.req.json<SessionPutBody>().catch(() => ({}) as SessionPutBody);
    const patch: SessionPutBody = {};

    if (body.titleId !== undefined) {
      if (typeof body.titleId !== 'string' || !body.titleId) {
        return c.json({ error: 'titleId must be a non-empty string' }, 400);
      }
      const title = await deps.contentStore.getTitle(body.titleId);
      if (!title) return c.json({ error: 'title not found' }, 404);
      patch.titleId = body.titleId;
    }

    if (body.positionMs !== undefined) {
      if (typeof body.positionMs !== 'number' || !Number.isFinite(body.positionMs) || body.positionMs < 0) {
        return c.json({ error: 'positionMs must be a non-negative finite number' }, 400);
      }
      let positionMs = body.positionMs;
      const effectiveTitleId = patch.titleId ?? existing.titleId;
      if (effectiveTitleId) {
        const title = await deps.contentStore.getTitle(effectiveTitleId);
        if (title) positionMs = Math.min(positionMs, title.durationMs);
      }
      patch.positionMs = positionMs;
    }

    if (body.playing !== undefined) {
      if (typeof body.playing !== 'boolean') {
        return c.json({ error: 'playing must be a boolean' }, 400);
      }
      patch.playing = body.playing;
    }

    const updated = await deps.sessionStore.update(code, patch);
    if (!updated) return c.json({ error: 'session not found' }, 404);
    return c.json(toPublicSession(updated));
  });

  app.get('/v1/sessions/:code', async (c) => {
    const code = c.req.param('code');
    const session = await deps.sessionStore.get(code);
    if (!session) return c.json({ error: 'session not found' }, 404);
    return c.json(toPublicSession(session));
  });

  mountMcp(app, deps);

  return app;
}
