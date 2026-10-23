import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoSessionStore } from '../src/store/session-dynamo.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('DynamoSessionStore', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('create() Puts a fresh session item with a ttl attribute', async () => {
    ddbMock.on(GetCommand).resolves({}); // no existing item during the uniqueness check
    ddbMock.on(PutCommand).resolves({});

    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
    const store = new DynamoSessionStore({ tableName: 'test-sessions', client });

    const session = await store.create();
    expect(session.code).toHaveLength(6);

    const putCall = ddbMock.commandCalls(PutCommand)[0];
    expect(putCall.args[0].input.TableName).toBe('test-sessions');
    expect(putCall.args[0].input.Item).toMatchObject({ code: session.code, positionMs: 0, playing: false });
    expect(typeof (putCall.args[0].input.Item as any).ttl).toBe('number');
  });

  it('get() strips the ttl attribute from the returned session', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { code: 'ABC123', positionMs: 5000, playing: true, updatedAt: 1000, ttl: 9999999999 }
    });

    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
    const store = new DynamoSessionStore({ tableName: 'test-sessions', client });

    const session = await store.get('ABC123');
    expect(session).toEqual({ code: 'ABC123', positionMs: 5000, playing: true, updatedAt: 1000 });
    expect(session).not.toHaveProperty('ttl');
  });

  it('get() returns undefined when the item does not exist', async () => {
    ddbMock.on(GetCommand).resolves({});
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
    const store = new DynamoSessionStore({ tableName: 'test-sessions', client });
    expect(await store.get('NOPE99')).toBeUndefined();
  });

  it('update() merges a patch (including sharedAnswer) via a full-item Put and preserves other fields', async () => {
    const existing = { code: 'ABC123', titleId: 'demo-1', positionMs: 5000, playing: true, updatedAt: 1000 };
    ddbMock.on(GetCommand).resolves({ Item: { ...existing, ttl: 9999999999 } });
    ddbMock.on(PutCommand).resolves({});

    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
    const store = new DynamoSessionStore({ tableName: 'test-sessions', client });

    const sharedAnswer = {
      id: 'answer-1',
      question: 'What happened?',
      answer: 'Something happened.',
      citations: [],
      mode: 'ask' as const,
      createdAt: 2000
    };

    const updated = await store.update('ABC123', { sharedAnswer });

    expect(updated).toMatchObject({ code: 'ABC123', titleId: 'demo-1', positionMs: 5000, sharedAnswer });

    const putCall = ddbMock.commandCalls(PutCommand)[0];
    expect(putCall.args[0].input.Item).toMatchObject({ code: 'ABC123', titleId: 'demo-1', sharedAnswer });
  });

  it('update() returns undefined for an unknown session code', async () => {
    ddbMock.on(GetCommand).resolves({});
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
    const store = new DynamoSessionStore({ tableName: 'test-sessions', client });
    expect(await store.update('NOPE99', { positionMs: 1 })).toBeUndefined();
  });
});
