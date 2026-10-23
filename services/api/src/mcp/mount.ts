import type { Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from './server.js';
import type { AppDeps } from '../app.js';

/**
 * Mounts the MCP Streamable HTTP endpoint at /mcp using the official SDK's
 * Web Standard transport (Request/Response), which runs unmodified on Node
 * (local dev) and on Lambda (hono/aws-lambda). Stateless mode: a fresh
 * McpServer + transport per request — no session affinity required, which is
 * what makes this safe behind a Lambda that can route to any instance.
 */
export function mountMcp(app: Hono, deps: AppDeps) {
  app.all('/mcp', async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createMcpServer(deps);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}
