import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSubtitles } from '@contextcue/core';
import type { Cue } from '@contextcue/core';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { ContentStore, PosterAsset, TitleMeta } from '../types.js';

const POSTER_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
};

/** Maps a poster filename's extension to its MIME type, defaulting to a generic
 * binary type for anything unrecognized (shouldn't happen — the route already
 * validates the filename against an allow-listed extension set). */
function posterContentType(file: string): string {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  return POSTER_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

async function streamToString(stream: unknown): Promise<string> {
  if (stream && typeof (stream as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBufferLike));
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
  throw new Error('Unsupported S3 body stream type');
}

// services/api/src/store/content.ts -> repo root is 4 levels up.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_CONTENT_DIR = path.resolve(__dirname, '../../../../content');

/**
 * Loads /content/titles.json + subtitle files from the local filesystem.
 * `contentDir` defaults to CONTENT_DIR env, or `<repoRoot>/content`.
 */
export class FsContentStore implements ContentStore {
  private contentDir: string;
  private titlesCache: TitleMeta[] | undefined;
  private cuesCache = new Map<string, Cue[]>();

  constructor(contentDir?: string) {
    this.contentDir = contentDir ?? process.env.CONTENT_DIR ?? REPO_ROOT_CONTENT_DIR;
  }

  private async loadTitles(): Promise<TitleMeta[]> {
    if (this.titlesCache) return this.titlesCache;
    try {
      const raw = await readFile(path.join(this.contentDir, 'titles.json'), 'utf-8');
      this.titlesCache = JSON.parse(raw) as TitleMeta[];
    } catch (err) {
      // Content is built by a separate agent/process in parallel; don't crash the whole
      // API (health checks, MCP, etc. should keep working) if it isn't there yet.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(
          `[content] titles.json not found at ${this.contentDir} — /v1/titles will return []. ` +
            'Set CONTENT_DIR or add /content/titles.json.'
        );
        this.titlesCache = [];
      } else {
        throw err;
      }
    }
    return this.titlesCache;
  }

  async listTitles(): Promise<TitleMeta[]> {
    return this.loadTitles();
  }

  async getTitle(id: string): Promise<TitleMeta | undefined> {
    const titles = await this.loadTitles();
    return titles.find((t) => t.id === id);
  }

  async getCues(id: string): Promise<Cue[]> {
    const cached = this.cuesCache.get(id);
    if (cached) return cached;

    const title = await this.getTitle(id);
    if (!title) return [];

    const subtitlePath = path.join(this.contentDir, title.subtitles);
    const raw = await readFile(subtitlePath, 'utf-8');
    const cues = parseSubtitles(raw);
    this.cuesCache.set(id, cues);
    return cues;
  }

  async getPoster(file: string): Promise<PosterAsset | undefined> {
    const postersDir = path.resolve(this.contentDir, 'posters');
    const resolved = path.resolve(postersDir, file);
    // Defense in depth against path traversal, independent of the route's own
    // filename validation: the resolved path must still land inside postersDir.
    if (resolved !== path.join(postersDir, path.basename(resolved)) || !resolved.startsWith(postersDir + path.sep)) {
      return undefined;
    }
    try {
      const data = await readFile(resolved);
      return { body: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), contentType: posterContentType(file) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }
}

/**
 * Loads /content from an S3 bucket (CONTENT_BUCKET). Same cache semantics as FsContentStore.
 */
export class S3ContentStore implements ContentStore {
  private bucket: string;
  private client: S3Client;
  private titlesCache: TitleMeta[] | undefined;
  private cuesCache = new Map<string, Cue[]>();

  constructor(opts: { bucket?: string; region?: string; client?: S3Client } = {}) {
    this.bucket = opts.bucket ?? process.env.CONTENT_BUCKET ?? '';
    this.client = opts.client ?? new S3Client({ region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1' });
  }

  private async getObjectText(key: string): Promise<string> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return streamToString(res.Body);
  }

  private async loadTitles(): Promise<TitleMeta[]> {
    if (this.titlesCache) return this.titlesCache;
    const raw = await this.getObjectText('titles.json');
    this.titlesCache = JSON.parse(raw) as TitleMeta[];
    return this.titlesCache;
  }

  async listTitles(): Promise<TitleMeta[]> {
    return this.loadTitles();
  }

  async getTitle(id: string): Promise<TitleMeta | undefined> {
    const titles = await this.loadTitles();
    return titles.find((t) => t.id === id);
  }

  async getCues(id: string): Promise<Cue[]> {
    const cached = this.cuesCache.get(id);
    if (cached) return cached;

    const title = await this.getTitle(id);
    if (!title) return [];

    const raw = await this.getObjectText(title.subtitles);
    const cues = parseSubtitles(raw);
    this.cuesCache.set(id, cues);
    return cues;
  }

  async getPoster(file: string): Promise<PosterAsset | undefined> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: `posters/${file}` }));
      if (!res.Body) return undefined;
      // Stream straight through rather than buffering the whole object in memory.
      const body = 'transformToWebStream' in res.Body ? res.Body.transformToWebStream() : (res.Body as unknown as ReadableStream<Uint8Array>);
      return { body, contentType: res.ContentType ?? posterContentType(file) };
    } catch (err) {
      const name = (err as { name?: string })?.name;
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (name === 'NoSuchKey' || name === 'NotFound' || status === 404) return undefined;
      throw err;
    }
  }
}

/** Choose FsContentStore vs S3ContentStore based on CONTENT_BUCKET env. */
export function contentStoreFromEnv(): ContentStore {
  if (process.env.CONTENT_BUCKET) return new S3ContentStore();
  return new FsContentStore();
}
