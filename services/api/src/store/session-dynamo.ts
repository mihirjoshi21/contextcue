import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { generateSessionCode } from '../ids.js';
import { generateTvToken, hashTvToken } from '../tv-token.js';
import type { CreatedSession, SessionState, SessionStore } from '../types.js';

const TTL_SECONDS = 12 * 60 * 60; // 12h

export interface DynamoSessionStoreOptions {
  tableName?: string;
  region?: string;
  client?: DynamoDBDocumentClient;
}

export class DynamoSessionStore implements SessionStore {
  private tableName: string;
  private doc: DynamoDBDocumentClient;

  constructor(opts: DynamoSessionStoreOptions = {}) {
    this.tableName = opts.tableName ?? process.env.SESSIONS_TABLE ?? 'contextcue-sessions';
    this.doc =
      opts.client ??
      DynamoDBDocumentClient.from(
        new DynamoDBClient({ region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1' })
      );
  }

  private ttl(): number {
    return Math.floor(Date.now() / 1000) + TTL_SECONDS;
  }

  async create(): Promise<CreatedSession> {
    let code = generateSessionCode();
    // Best-effort uniqueness check; collisions are astronomically unlikely at 6 chars.
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await this.get(code);
      if (!existing) break;
      code = generateSessionCode();
    }
    const tvToken = generateTvToken();
    const state: SessionState = {
      code,
      positionMs: 0,
      playing: false,
      updatedAt: Date.now(),
      tvTokenHash: hashTvToken(tvToken)
    };
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { ...state, ttl: this.ttl() }
      })
    );
    return { ...state, tvToken };
  }

  async get(code: string): Promise<SessionState | undefined> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { code } })
    );
    if (!res.Item) return undefined;
    const { ttl, ...state } = res.Item as SessionState & { ttl: number };
    return state;
  }

  async update(
    code: string,
    patch: Partial<Pick<SessionState, 'titleId' | 'positionMs' | 'playing' | 'sharedAnswer'>>
  ): Promise<SessionState | undefined> {
    const existing = await this.get(code);
    if (!existing) return undefined;

    // Read-modify-write as a full item Put, rather than a hand-maintained
    // UpdateExpression per field: simpler, and it means a new SessionState
    // field (like `sharedAnswer`) never needs a matching Dynamo-side change.
    const updated: SessionState = { ...existing, ...patch, updatedAt: Date.now() };
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { ...updated, ttl: this.ttl() }
      })
    );
    return updated;
  }
}
