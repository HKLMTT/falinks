import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import type { Router } from '../core/router.js';
import { t } from '../i18n/index.js';

const PATH_RE = /^\/agent\/([^/]+)\/mcp$/;

/** 员工向老板出的、待老板点选的选择题。 */
export interface PendingQuestion {
  id: string;
  from: string;
  question: string;
  options: string[];
  ts: number;
}

/** 进程内的待答问题存储（ask 工具写入，控制台轮询 /admin/questions 读，/admin/answer 取走）。 */
export class QuestionStore {
  private map = new Map<string, PendingQuestion>();
  private seq = 0;
  add(q: { from: string; question: string; options: string[] }): string {
    const id = `q${++this.seq}`;
    this.map.set(id, { id, from: q.from, question: q.question, options: q.options, ts: Date.now() });
    return id;
  }
  list(): PendingQuestion[] {
    return [...this.map.values()];
  }
  take(id: string): PendingQuestion | undefined {
    const q = this.map.get(id);
    if (q) this.map.delete(id);
    return q;
  }
}

export interface BusDeps {
  router: Router;
  getSessionId(name: string): string | undefined;
  onAddAgent?(spec: { name: string; cli: string; cwd: string; role?: string; bootstrap?: string; model?: string }): Promise<{ ok: boolean; error?: string }>;
  onRemoveAgent?(name: string): Promise<{ ok: boolean; error?: string }>;
  onClear?(name?: string): Promise<{ ok: boolean; cleared?: string[]; error?: string }>;
  onShutdown?(closePanes: boolean): Promise<{ ok: boolean }>;
  onLang?(locale: 'zh' | 'en' | 'auto'): Promise<'zh' | 'en'>;
  onSetLead?(name: string): Promise<{ ok: boolean; error?: string }>;
  /** 运行时改 lead 周期重置配置并写回 config 文件。 */
  onLeadReset?(p: { enabled?: boolean; every?: number }): Promise<{ ok: boolean; error?: string; enabled?: boolean; every?: number }>;
  /** 重启某员工的 CLI(带正确 MCP 配置;fresh=清会话记录全新开局)。 */
  onRestartAgent?(name: string, fresh: boolean): Promise<{ ok: boolean; error?: string }>;
  /** 返回最近的诊断事件(守卫丢消息/注入失败/可疑自动 idle)；缺省视为无诊断。 */
  getDiag?(): unknown[];
  /** todolist 引擎入口(index.ts 注入):taskdone 上报、op 命令分发、state 只读快照。 */
  todo?: {
    taskdone(seq: number, status: 'done' | 'failed', result: string): { ok: boolean; error?: string };
    /** lead 声明当前任务等待外部过程(taskwait 工具):minutes 分钟内暂停空闲巡查。 */
    taskwait(seq: number, minutes: number, reason: string): { ok: boolean; error?: string };
    op(op: string, args: { body?: string; seq?: number; n?: number }): { ok: boolean; error?: string; [k: string]: unknown };
    state(): unknown;
    /** lead 批量建单(todoplan 工具):from=调用者名(通知留痕用)。 */
    plan(tasks: string[], replace: boolean, from: string): { ok: boolean; error?: string; seqs?: number[] };
    /** lead 写/换项目状态档(leadstate 工具)。 */
    leadstate(content: string): { ok: boolean; error?: string };
  };
}

export interface Bus {
  port: number;
  close(): Promise<void>;
}

export interface BusOptions {
  /** 实例身份,/admin/info 返回它(寻址方核对 cwd 用)。 */
  identity?: { cwd: string; startedAt: number };
  /** 显式端口被占用、回退系统分配后回调(告警呈现交给调用方)。 */
  onPortFallback?(wanted: number, got: number): void;
}

function ok(obj: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj) }] };
}

function body_locale_invalid(l: unknown): boolean {
  return l !== 'zh' && l !== 'en' && l !== 'auto';
}

function serverForAgent(agentName: string, deps: BusDeps, questions: QuestionStore): McpServer {
  const { router } = deps;
  // 任何工具调用 = 该员工经 MCP 活着的铁证(失联自愈)。服务端代登记不经此处,不会误打点。
  const touch = () => router.touchMcp(agentName);
  const server = new McpServer({ name: `falinks-bus-${agentName}`, version: '1.0.0' }, { capabilities: {} });

  // send 返回 undefined 有三种原因,旧代码一律报 "unknown or dead target" → agent 误判对方已死而放弃,
  // 实际可能是被守卫(回合上限/循环/限流)拦下。这里据当前花名册状态准确分类,给 agent 可行动的反馈。
  const explainUndeliverable = (to: string): string => {
    const target = router.resolve(to);
    if (!target) return `unknown target: ${to}`;
    if (router.get(target)?.status === 'dead') return `target dead: ${to}`;
    return `blocked by guardrail (turn cap / loop / rate limit), message NOT delivered: ${to}`;
  };

  server.registerTool('register', { description: t().toolDescRegister, inputSchema: {} }, async () => {
    touch();
    const sid = deps.getSessionId(agentName);
    if (!sid) return ok({ ok: false, error: 'no session for agent' });
    router.register(agentName, sid);
    return ok({ ok: true, you: agentName, roster: router.roster().map((a) => ({ name: a.name, role: a.role, status: a.status })) });
  });

  server.registerTool('sendmsg', {
    description: t().toolDescSendmsg, inputSchema: { to: z.string(), message: z.string() },
  }, async ({ to, message }) => {
    touch();
    const msg = router.send(agentName, to, message);
    return msg ? ok({ ok: true, id: msg.id, to: msg.to }) : ok({ ok: false, error: explainUndeliverable(to) });
  });

  server.registerTool('idle', { description: t().toolDescIdle, inputSchema: {} }, async () => {
    touch();
    router.onIdle(agentName);
    return ok({ ok: true });
  });

  server.registerTool('ask', {
    description: t().toolDescAsk,
    inputSchema: { to: z.string(), question: z.string(), options: z.array(z.string()).min(1) },
  }, async ({ to, question, options }) => {
    touch();
    if (to === 'boss' || to === '老板') {
      const id = questions.add({ from: agentName, question, options });
      return ok({ ok: true, id, pending: true });
    }
    const body = t().askToPeer(question, options.map((o, i) => `${i + 1}. ${o}`).join('\n'), agentName);
    const msg = router.send(agentName, to, body);
    return msg ? ok({ ok: true, id: msg.id, to: msg.to }) : ok({ ok: false, error: explainUndeliverable(to) });
  });

  server.registerTool('who', { description: t().toolDescWho, inputSchema: {} }, async () => {
    touch();
    return ok({ roster: router.roster().map((a) => ({ name: a.name, role: a.role, status: a.status })) });
  });

  server.registerTool('taskdone', {
    description: t().toolDescTaskdone,
    inputSchema: { seq: z.number(), status: z.enum(['done', 'failed']), result: z.string() },
  }, async ({ seq, status, result }) => {
    touch();
    if (!deps.todo) return ok({ ok: false, error: 'todolist not available' });
    if (!router.get(agentName)?.lead) return ok({ ok: false, error: 'only the lead can call taskdone' });
    return ok(deps.todo.taskdone(seq, status, result));
  });

  server.registerTool('todoplan', {
    description: t().toolDescTodoplan,
    inputSchema: { tasks: z.array(z.string()).min(1), replace: z.boolean().optional() },
  }, async ({ tasks, replace }) => {
    touch();
    if (!deps.todo) return ok({ ok: false, error: 'todolist not available' });
    if (!router.get(agentName)?.lead) return ok({ ok: false, error: 'only the lead can call todoplan' });
    return ok(deps.todo.plan(tasks, replace === true, agentName));
  });

  server.registerTool('todostart', {
    description: t().toolDescTodostart,
    inputSchema: { nudgeMinutes: z.number().optional() },
  }, async ({ nudgeMinutes }) => {
    touch();
    if (!deps.todo) return ok({ ok: false, error: 'todolist not available' });
    if (!router.get(agentName)?.lead) return ok({ ok: false, error: 'only the lead can call todostart' });
    return ok(deps.todo.op('start', { n: nudgeMinutes }));
  });

  server.registerTool('taskwait', {
    description: t().toolDescTaskwait,
    inputSchema: { seq: z.number(), minutes: z.number().int().min(1).max(120), reason: z.string().optional() },
  }, async ({ seq, minutes, reason }) => {
    touch();
    if (!deps.todo) return ok({ ok: false, error: 'todolist not available' });
    if (!router.get(agentName)?.lead) return ok({ ok: false, error: 'only the lead can call taskwait' });
    return ok(deps.todo.taskwait(seq, minutes, reason ?? ''));
  });

  server.registerTool('leadstate', {
    description: t().toolDescLeadstate,
    inputSchema: { content: z.string() },
  }, async ({ content }) => {
    touch();
    if (!deps.todo) return ok({ ok: false, error: 'todolist not available' });
    if (!router.get(agentName)?.lead) return ok({ ok: false, error: 'only the lead can call leadstate' });
    return ok(deps.todo.leadstate(content));
  });

  return server;
}

export async function startBus(deps: BusDeps, port: number, opts?: BusOptions): Promise<Bus> {
  const identity = {
    cwd: opts?.identity?.cwd ?? process.cwd(),
    pid: process.pid,
    startedAt: opts?.identity?.startedAt ?? Date.now(),
  };
  const questions = new QuestionStore();
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
      if (req.method === 'GET' && url.pathname === '/admin/info') {
        return sendJson(identity);
      }
      if (req.method === 'GET' && url.pathname === '/admin/roster') {
        return sendJson({ roster: router.roster().map((a) => ({ name: a.name, role: a.role, status: a.status, virtual: !!a.virtual, lead: !!a.lead, unresponsive: !!a.unresponsive, rule: a.unresponsiveRule, mcpSeen: a.lastMcpHttpAt != null })) });
      }
      if (req.method === 'GET' && url.pathname === '/admin/log') {
        const queued = router.queuedMessageIds();
        const all = router.messages().map((m) => ({ ...m, queued: queued.has(m.id) }));
        const limitRaw = url.searchParams.get('limit');
        const limit = limitRaw !== null ? Number(limitRaw) : NaN;
        const log = Number.isInteger(limit) && limit > 0 ? all.slice(-limit) : all;
        return sendJson({ log });
      }
      if (req.method === 'GET' && url.pathname === '/admin/questions') {
        return sendJson({ questions: questions.list() });
      }
      if (req.method === 'GET' && url.pathname === '/admin/diag') {
        const all = deps.getDiag ? deps.getDiag() : [];
        const limitRaw = url.searchParams.get('limit');
        const limit = limitRaw !== null ? Number(limitRaw) : NaN;
        const diag = Number.isInteger(limit) && limit > 0 ? all.slice(-limit) : all;
        return sendJson({ diag });
      }
      if (req.method === 'POST' && url.pathname === '/admin/answer') {
        const q = questions.take(String(abody.id));
        if (!q) return sendJson({ ok: false, error: 'no such question' });
        // 自定义回答:老板没选预设项,而是自由输入文本 → 直接把文本注回提问者。
        if (typeof abody.text === 'string' && abody.text.trim()) {
          router.send('boss', q.from, t().bossAnswered(q.question, abody.text.trim()));
          return sendJson({ ok: true });
        }
        const choice = Number(abody.choice);
        if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) {
          return sendJson({ ok: false, error: 'bad choice' });
        }
        router.send('boss', q.from, t().bossPicked(q.question, q.options[choice]));
        return sendJson({ ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/admin/say') {
        const msg = router.send('boss', String(abody.to), String(abody.message), { urgent: abody.urgent === true });
        return sendJson(msg ? { ok: true, id: msg.id } : { ok: false, error: 'unknown or dropped' });
      }
      if (req.method === 'POST' && url.pathname === '/admin/promote') {
        // 把排队消息提升为插队直送;失败原因透传(gone=已投出/不存在,not-ready=目标未就绪留队,dead=目标已死留队)。
        const r = router.promoteQueued(String(abody.id));
        // 'not queued' fallback 仅防御:promoteQueued 失败必带 reason(类型上 reason 可选才留此兜底)。
        return sendJson(r.ok ? { ok: true, to: r.to } : { ok: false, error: r.reason ?? 'not queued' });
      }
      if (req.method === 'POST' && url.pathname === '/admin/cancel') {
        // 撤销仍在排队的消息;已投出/不存在 → ok:false(控制台提示"可能已送达")。
        const r = router.cancelQueued(String(abody.id));
        return sendJson(r.ok ? { ok: true, to: r.to } : { ok: false, error: 'not queued' });
      }
      if (req.method === 'POST' && url.pathname === '/admin/broadcast') {
        const sent: string[] = [];
        for (const a of router.roster()) {
          if (a.virtual || a.status === 'dead' || a.name === 'boss') continue;
          if (router.send('boss', a.name, String(abody.message), { urgent: abody.urgent === true })) sent.push(a.name);
        }
        return sendJson({ sent });
      }
      if (req.method === 'POST' && url.pathname === '/admin/add') {
        if (!deps.onAddAgent) return sendJson({ ok: false, error: 'add not supported' });
        try {
          const r = await deps.onAddAgent({ name: String(abody.name), cli: String(abody.cli), cwd: String(abody.cwd), role: abody.role, bootstrap: abody.bootstrap, model: typeof abody.model === 'string' && abody.model ? abody.model : undefined });
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
      if (req.method === 'POST' && url.pathname === '/admin/clear') {
        if (!deps.onClear) return sendJson({ ok: false, error: 'clear not supported' });
        try {
          const r = await deps.onClear(abody.name ? String(abody.name) : undefined);
          return sendJson(r);
        } catch (e: any) {
          return sendJson({ ok: false, error: String(e?.message ?? e) });
        }
      }
      if (req.method === 'POST' && url.pathname === '/admin/shutdown') {
        if (!deps.onShutdown) return sendJson({ ok: false, error: 'shutdown not supported' });
        try {
          const r = await deps.onShutdown(abody.closePanes !== false); // 缺省按关闭
          return sendJson(r);
        } catch (e: any) {
          return sendJson({ ok: false, error: String(e?.message ?? e) });
        }
      }
      if (req.method === 'POST' && url.pathname === '/admin/lang') {
        if (body_locale_invalid(abody.locale)) return sendJson({ ok: false, error: 'bad locale' });
        if (!deps.onLang) return sendJson({ ok: false, error: 'lang not supported' });
        try {
          const eff = await deps.onLang(abody.locale);
          return sendJson({ ok: true, locale: eff });
        } catch (e: any) {
          return sendJson({ ok: false, error: String(e?.message ?? e) });
        }
      }
      if (req.method === 'POST' && url.pathname === '/admin/lead') {
        if (!deps.onSetLead) return sendJson({ ok: false, error: 'lead not supported' });
        try {
          const r = await deps.onSetLead(String(abody.name));
          return sendJson(r);
        } catch (e: any) {
          return sendJson({ ok: false, error: String(e?.message ?? e) });
        }
      }
      if (req.method === 'POST' && url.pathname === '/admin/restart') {
        if (!deps.onRestartAgent) return sendJson({ ok: false, error: 'restart not supported' });
        try {
          const r = await deps.onRestartAgent(String(abody.name), abody.fresh === true);
          return sendJson(r);
        } catch (e: any) {
          return sendJson({ ok: false, error: String(e?.message ?? e) });
        }
      }
      if (req.method === 'GET' && url.pathname === '/admin/todo') {
        return sendJson({ todo: deps.todo ? deps.todo.state() : null });
      }
      if (req.method === 'POST' && url.pathname === '/admin/todo') {
        if (!deps.todo) return sendJson({ ok: false, error: 'todo not supported' });
        try {
          return sendJson(deps.todo.op(String(abody.op), { body: abody.body, seq: abody.seq, n: abody.n }));
        } catch (e: any) {
          return sendJson({ ok: false, error: String(e?.message ?? e) });
        }
      }
      if (req.method === 'POST' && url.pathname === '/admin/leadreset') {
        if (!deps.onLeadReset) return sendJson({ ok: false, error: 'not supported' });
        return sendJson(await deps.onLeadReset({ enabled: abody.enabled, every: abody.every }));
      }
      res.writeHead(404); res.end('unknown admin route');
      return;
    }

    const match = PATH_RE.exec(url.pathname);
    if (!match) { res.writeHead(404); res.end('not found'); return; }
    // 路径里的中文/非 ASCII 名会被 HTTP 客户端百分号编码，需解码回真实名（否则与注册名对不上）。
    let agentName: string;
    try { agentName = decodeURIComponent(match[1]); } catch { agentName = match[1]; }
    deps.router.touchMcpHttp(agentName); // CLI 启动 initialize 即打点;只用于告警文案分流

    let body: unknown;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { body = undefined; }
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = serverForAgent(agentName, deps, questions);
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });

  return new Promise((resolve, reject) => {
    const tryListen = (p: number, isRetry: boolean) => {
      httpServer.once('error', (e: NodeJS.ErrnoException) => {
        // 显式端口被占用:回退系统分配重试一次(多实例并发的常态,不是错误)。
        if (e.code === 'EADDRINUSE' && !isRetry) { tryListen(0, true); return; }
        reject(e);
      });
      httpServer.listen(p, '127.0.0.1', () => {
        const addr = httpServer.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : p;
        if (isRetry) opts?.onPortFallback?.(port, actualPort);
        resolve({
          port: actualPort,
          close: () => new Promise<void>((r) => httpServer.close(() => r())),
        });
      });
    };
    tryListen(port, false);
  });
}
