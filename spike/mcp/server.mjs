/**
 * Spike: MCP Streamable HTTP server with per-path agent identity
 *
 * Approach: Plain Node http.createServer; parse req.url to extract agent name;
 * use STATELESS per-request transports (sessionIdGenerator: undefined) so each
 * POST creates a fresh transport+server pair — no session state needed for the spike.
 * The agent name is stashed on a Map keyed by transport instance so the tool handler
 * can read it back.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';

const PORT = 3737;

// Map<transport, agentName> — lets the tool handler look up the current transport's agent
const transportAgent = new Map();

function createServer(agentName) {
  const server = new McpServer(
    { name: `agent-${agentName}-server`, version: '1.0.0' },
    { capabilities: {} }
  );

  server.registerTool(
    'echo',
    {
      description: 'Echoes back the message and identifies who called',
      inputSchema: { message: z.string().describe('Message to echo') },
    },
    async ({ message }, extra) => {
      // The transport is available as extra._transport (internal) but the cleaner way
      // is to close over agentName directly since we create one server per request.
      console.log(`[server] echo called by agent="${agentName}" message="${message}"`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ agent: agentName, echo: message }),
          },
        ],
      };
    }
  );

  return server;
}

// Pattern: /agent/:name/mcp
const PATH_RE = /^\/agent\/([^/]+)\/mcp$/;

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const match = PATH_RE.exec(url.pathname);

  if (!match) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use /agent/<name>/mcp' }));
    return;
  }

  const agentName = match[1];

  // Collect body for POST
  let body = undefined;
  if (req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    try { body = JSON.parse(raw); } catch { body = raw; }
  }

  // Stateless: fresh transport + server per POST request
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  const mcpServer = createServer(agentName);

  res.on('close', () => {
    transport.close().catch(() => {});
    mcpServer.close().catch(() => {});
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error('[server] error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
  }
});

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] MCP server listening on http://127.0.0.1:${PORT}`);
  console.log(`[server] Paths: /agent/alice/mcp  /agent/bob/mcp  etc.`);
});
