import * as z from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatTimestamp } from '@contextcue/core';
import { answerQuestion, DEFAULT_QUESTION_BY_MODE } from '../ask.js';
import type { AppDeps } from '../app.js';

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true as const };
}

/**
 * Builds one MCP server instance wired to the given app dependencies. Tools are the
 * surface Alexa+ (or any MCP client) sees, so descriptions are written for a model/voice
 * assistant reading them, not for a developer.
 */
export function createMcpServer(deps: AppDeps): McpServer {
  const server = new McpServer({
    name: 'contextcue',
    version: '0.1.0'
  });

  server.registerTool(
    'get_now_playing',
    {
      title: 'Get now playing',
      description:
        "Get what's currently playing in a ContextCue viewing session: the title and how far the " +
        'viewer has watched. Use this before answering a question so you know the show/movie in play. ' +
        'Requires the 6-character session code shown on the TV or companion app.',
      inputSchema: {
        sessionCode: z.string().describe('The 6-character session code shown on the TV/companion app')
      }
    },
    async ({ sessionCode }) => {
      const session = await deps.sessionStore.get(sessionCode);
      if (!session) return errorResult(`No active session found for code ${sessionCode}.`);
      if (!session.titleId) return textResult('A session was found, but nothing is playing yet.');

      const title = await deps.contentStore.getTitle(session.titleId);
      if (!title) return errorResult(`Session references an unknown title: ${session.titleId}`);

      return textResult(
        `Now playing: "${title.title}" at ${formatTimestamp(session.positionMs)}` +
          (session.playing ? ' (playing).' : ' (paused).')
      );
    }
  );

  server.registerTool(
    'ask_spoiler_free',
    {
      title: 'Ask a spoiler-free question',
      description:
        'Ask a question about the show/movie currently playing in a ContextCue session, answered ONLY ' +
        "from what has already aired — nothing past the viewer's current position is ever used, so this " +
        'is always safe from spoilers. Good for "who is that?", "why did she do that?", "what does X mean?". ' +
        'Requires the 6-character session code shown on the TV or companion app.',
      inputSchema: {
        sessionCode: z.string().describe('The 6-character session code shown on the TV/companion app'),
        question: z.string().describe('The natural-language question to answer, spoiler-free')
      }
    },
    async ({ sessionCode, question }) => {
      const session = await deps.sessionStore.get(sessionCode);
      if (!session) return errorResult(`No active session found for code ${sessionCode}.`);
      if (!session.titleId) return errorResult('Nothing is playing in this session yet.');

      const response = await answerQuestion(deps, {
        titleId: session.titleId,
        positionMs: session.positionMs,
        question,
        mode: 'ask'
      });

      return textResult(response.answer);
    }
  );

  server.registerTool(
    'catch_me_up',
    {
      title: 'Catch me up',
      description:
        'Give a short, spoiler-free recap of what has happened so far in the show/movie currently playing ' +
        'in a ContextCue session — great for "catch me up" or after stepping away from the TV. Optionally ' +
        'scope the recap to roughly the last N minutes of story. Requires the session code shown on the TV.',
      inputSchema: {
        sessionCode: z.string().describe('The 6-character session code shown on the TV/companion app'),
        minutes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Optional: only recap roughly the last N minutes of story instead of everything so far')
      }
    },
    async ({ sessionCode, minutes }) => {
      const session = await deps.sessionStore.get(sessionCode);
      if (!session) return errorResult(`No active session found for code ${sessionCode}.`);
      if (!session.titleId) return errorResult('Nothing is playing in this session yet.');

      const response = await answerQuestion(deps, {
        titleId: session.titleId,
        positionMs: session.positionMs,
        question: DEFAULT_QUESTION_BY_MODE.recap,
        mode: 'recap',
        contextOpts: minutes ? { recentWindowMs: minutes * 60_000 } : undefined
      });

      return textResult(response.answer);
    }
  );

  server.registerTool(
    'who_is',
    {
      title: 'Who is that?',
      description:
        'Identify a character in the show/movie currently playing in a ContextCue session, based on a ' +
        'natural description (e.g. "the guy in the red jacket", "the woman who just walked in"). Uses only ' +
        "what's aired so far, so it never spoils who a character turns out to be. Requires the session code.",
      inputSchema: {
        sessionCode: z.string().describe('The 6-character session code shown on the TV/companion app'),
        description: z.string().describe('A natural-language description of the character to identify')
      }
    },
    async ({ sessionCode, description }) => {
      const session = await deps.sessionStore.get(sessionCode);
      if (!session) return errorResult(`No active session found for code ${sessionCode}.`);
      if (!session.titleId) return errorResult('Nothing is playing in this session yet.');

      const response = await answerQuestion(deps, {
        titleId: session.titleId,
        positionMs: session.positionMs,
        question: `Who is ${description}?`,
        mode: 'who'
      });

      return textResult(response.answer);
    }
  );

  return server;
}
