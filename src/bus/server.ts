import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import type { Router } from '../core/router.js';

const PATH_RE = /^\/agent\/([^/]+)\/mcp$/;

export interface BusDeps {
  router: Router;
  getSessionId(name: string): string | undefined;
}

export interface Bus {
  port: number;
  close(): Promise<void>;
}

function ok(obj: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj) }] };
}

function serverForAgent(agentName: string, deps: BusDeps): McpServer {
  const { router } = deps;
  const server = new McpServer({ name: `dagent-bus-${agentName}`, version: '1.0.0' }, { capabilities: {} });

  server.registerTool('register', { description: '报到：告知 dagent 你已就绪', inputSchema: {} }, async () => {
    const sid = deps.getSessionId(agentName);
    if (!sid) return ok({ ok: false, error: 'no session for agent' });
    router.register(agentName, sid);
    return ok({ ok: true, you: agentName, roster: router.roster().map((a) => ({ name: a.name, role: a.role, status: a.status })) });
  });

  server.registerTool('sendmsg', {
    description: '给某个同事/角色发消息', inputSchema: { to: z.string(), message: z.string() },
  }, async ({ to, message }) => {
    const msg = router.send(agentName, to, message);
    return msg ? ok({ ok: true, id: msg.id, to: msg.to }) : ok({ ok: false, error: `unknown or dead target: ${to}` });
  });

  server.registerTool('idle', { description: '本回合收尾，释放空闲状态', inputSchema: {} }, async () => {
    router.onIdle(agentName);
    return ok({ ok: true });
  });

  server.registerTool('who', { description: '查看在线花名册', inputSchema: {} }, async () => {
    return ok({ roster: router.roster().map((a) => ({ name: a.name, role: a.role, status: a.status })) });
  });

  return server;
}

export function startBus(deps: BusDeps, port: number): Promise<Bus> {
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    const match = PATH_RE.exec(url.pathname);
    if (!match) { res.writeHead(404); res.end('not found'); return; }
    const agentName = match[1];

    let body: unknown;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { body = undefined; }
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = serverForAgent(agentName, deps);
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });

  return new Promise((resolve) => {
    httpServer.listen(port, '127.0.0.1', () => {
      const addr = httpServer.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        port: actualPort,
        close: () => new Promise<void>((r) => httpServer.close(() => r())),
      });
    });
  });
}
