import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import type { Router } from '../core/router.js';

const PATH_RE = /^\/agent\/([^/]+)\/mcp$/;

export interface BusDeps {
  router: Router;
  getSessionId(name: string): string | undefined;
  onAddAgent?(spec: { name: string; cli: string; cwd: string; role?: string; bootstrap?: string }): Promise<{ ok: boolean; error?: string }>;
  onRemoveAgent?(name: string): Promise<{ ok: boolean; error?: string }>;
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
  const server = new McpServer({ name: `falinks-bus-${agentName}`, version: '1.0.0' }, { capabilities: {} });

  server.registerTool('register', { description: '报到：告知 falinks 你已就绪', inputSchema: {} }, async () => {
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

    // ---- admin 路由（人/老板入口）----
    if (url.pathname.startsWith('/admin/')) {
      const { router } = deps;
      const sendJson = (obj: unknown) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      let abody: any = {};
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        try { abody = JSON.parse(Buffer.concat(chunks).toString()); } catch { abody = {}; }
      }
      if (req.method === 'GET' && url.pathname === '/admin/roster') {
        return sendJson({ roster: router.roster().map((a) => ({ name: a.name, role: a.role, status: a.status, virtual: !!a.virtual })) });
      }
      if (req.method === 'GET' && url.pathname === '/admin/log') {
        return sendJson({ log: router.messages() });
      }
      if (req.method === 'POST' && url.pathname === '/admin/say') {
        const msg = router.send('boss', String(abody.to), String(abody.message));
        return sendJson(msg ? { ok: true, id: msg.id } : { ok: false, error: 'unknown or dropped' });
      }
      if (req.method === 'POST' && url.pathname === '/admin/broadcast') {
        const sent: string[] = [];
        for (const a of router.roster()) {
          if (a.virtual || a.status === 'dead' || a.name === 'boss') continue;
          if (router.send('boss', a.name, String(abody.message))) sent.push(a.name);
        }
        return sendJson({ sent });
      }
      if (req.method === 'POST' && url.pathname === '/admin/add') {
        if (!deps.onAddAgent) return sendJson({ ok: false, error: 'add not supported' });
        try {
          const r = await deps.onAddAgent({ name: String(abody.name), cli: String(abody.cli), cwd: String(abody.cwd), role: abody.role, bootstrap: abody.bootstrap });
          return sendJson(r);
        } catch (e: any) {
          return sendJson({ ok: false, error: String(e?.message ?? e) });
        }
      }
      if (req.method === 'POST' && url.pathname === '/admin/remove') {
        if (!deps.onRemoveAgent) return sendJson({ ok: false, error: 'remove not supported' });
        try {
          const r = await deps.onRemoveAgent(String(abody.name));
          return sendJson(r);
        } catch (e: any) {
          return sendJson({ ok: false, error: String(e?.message ?? e) });
        }
      }
      res.writeHead(404); res.end('unknown admin route');
      return;
    }

    const match = PATH_RE.exec(url.pathname);
    if (!match) { res.writeHead(404); res.end('not found'); return; }
    // 路径里的中文/非 ASCII 名会被 HTTP 客户端百分号编码，需解码回真实名（否则与注册名对不上）。
    let agentName: string;
    try { agentName = decodeURIComponent(match[1]); } catch { agentName = match[1]; }

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

  return new Promise((resolve, reject) => {
    httpServer.once('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') {
        console.error(`端口 ${port} 已被占用 —— 可能已有一个 falinks 在运行。先 Ctrl-C 关掉它，或在配置里改 busPort。`);
        process.exit(1);
      }
      reject(e);
    });
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
