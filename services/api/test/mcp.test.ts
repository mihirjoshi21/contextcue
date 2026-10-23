import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { makeTestDeps } from './helpers.js';

let server: ServerType;
let baseUrl: string;
let sessionCode: string;

beforeAll(async () => {
  const deps = makeTestDeps();
  const app = createApp(deps);

  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      baseUrl = `http://localhost:${info.port}`;
      resolve();
    });
  });

  // Seed a session pointed at the fixture title, past the first few cues.
  const created = (await (await fetch(`${baseUrl}/v1/sessions`, { method: 'POST' })).json()) as any;
  sessionCode = created.code;
  await fetch(`${baseUrl}/v1/sessions/${sessionCode}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-tv-token': created.tvToken },
    body: JSON.stringify({ titleId: 'demo-1', positionMs: 20_000, playing: true })
  });
});

afterAll(() => {
  server?.close();
});

describe('MCP Streamable HTTP roundtrip', () => {
  it('lists tools and calls ask_spoiler_free through a real MCP client/transport', async () => {
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));

    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['get_now_playing', 'ask_spoiler_free', 'catch_me_up', 'who_is'])
    );

    const result = await client.callTool({
      name: 'ask_spoiler_free',
      arguments: { sessionCode, question: 'What has happened so far?' }
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0].type).toBe('text');
    expect(content[0].text).not.toContain('SECRET_FUTURE_LINE');

    await client.close();
  });

  it('get_now_playing reports the title and position for a live session', async () => {
    const client = new Client({ name: 'test-client-2', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await client.connect(transport);

    const result = await client.callTool({
      name: 'get_now_playing',
      arguments: { sessionCode }
    });

    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0].text).toContain('Test Movie');

    await client.close();
  });

  it('returns an error result for an unknown session code', async () => {
    const client = new Client({ name: 'test-client-3', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await client.connect(transport);

    const result = await client.callTool({
      name: 'get_now_playing',
      arguments: { sessionCode: 'NOPE99' }
    });

    expect(result.isError).toBe(true);

    await client.close();
  });
});
