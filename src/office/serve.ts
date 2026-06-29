import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OFFICE } from '../core/office.js';

/** /office/state 返回结构(与前端约定)。 */
export interface OfficeState {
  ts: number;
  office: string; // 办公室 id(默认办公室=DEFAULT_OFFICE);frontend 页眉据此显示 `· <office>` 后缀。
  roster: Array<{ name: string; role: string; status: string; virtual: boolean; lead: boolean; assistant: boolean; unresponsive: boolean; queue: number }>;
  log: Array<{ id: string; from: string; to: string; body: string; ts: number; thread?: string }>;
  questions: Array<{ id: string; from: string; question: string; options: string[]; ts: number }>;
}

/** buildOfficeState/handleOfficeRequest 的依赖:复用 router 取数 + 待答问题源。 */
export interface OfficeDeps {
  router: {
    roster(): Array<{ name: string; role?: string; status: string; virtual?: boolean; lead?: boolean; assistant?: boolean; unresponsive?: boolean; inbox?: unknown[]; queue?: number }>;
    messages(): Array<{ id: string; from: string; to: string; body: string; ts: number; thread?: string }>;
  };
  questions: { list(): Array<{ id: string; from: string; question: string; options: string[]; ts: number }> };
  /** 本实例的办公室 id(由 bus identity 透入);缺省=默认办公室。 */
  office?: string;
  /** 静态根覆盖(测试用);缺省=本模块同级 web/(dist/office/web 或 src/office/web)。 */
  webRoot?: string;
  /** 时间源(测试用)。 */
  now?: () => number;
}

const MAX_LOG = 200;

/** 聚合 roster + 最近 200 条消息(时间升序) + 待答问题,供前端单次轮询。 */
export function buildOfficeState(deps: OfficeDeps): OfficeState {
  const now = deps.now ?? Date.now;
  const roster = deps.router.roster().map((a) => ({
    name: a.name,
    role: a.role ?? '',
    status: a.status,
    virtual: !!a.virtual,
    lead: !!a.lead,
    assistant: !!a.assistant,
    unresponsive: !!a.unresponsive,
    // 队列深度 = 该 agent 仍在 inbox 排队、尚未投出的消息数,用于表现繁忙程度。
    // 优先取真实 inbox.length;mock/测试可直接给 queue;拿不到则 0(健壮)。
    queue: Array.isArray(a.inbox) ? a.inbox.length : typeof a.queue === 'number' ? a.queue : 0,
  }));
  const all = deps.router.messages();
  const log = all.slice(-MAX_LOG).map((m) => ({ id: m.id, from: m.from, to: m.to, body: m.body, ts: m.ts, thread: m.thread }));
  const questions = deps.questions.list().map((q) => ({ id: q.id, from: q.from, question: q.question, options: q.options, ts: q.ts }));
  return { ts: now(), office: deps.office ?? DEFAULT_OFFICE, roster, log, questions };
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function defaultWebRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'web');
}

function serveFile(res: http.ServerResponse, abs: string): void {
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  const ext = path.extname(abs).toLowerCase();
  res.writeHead(200, { 'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream' });
  const stream = createReadStream(abs);
  stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
  stream.pipe(res);
}

/**
 * 命中 /office、/office/state、/office/<asset> 时处理并返回 true;否则返回 false(让原有分发继续)。
 * 仅 GET;静态文件含 content-type;路径穿越(.. / 解析逃逸出 web 根)→ 403。
 */
export function handleOfficeRequest(req: http.IncomingMessage, res: http.ServerResponse, deps: OfficeDeps): boolean {
  const url = new URL(req.url ?? '', `http://${req.headers.host ?? '127.0.0.1'}`);
  const pathname = url.pathname;
  if (pathname !== '/office' && pathname !== '/office/' && !pathname.startsWith('/office/')) return false;
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('method not allowed');
    return true;
  }

  if (pathname === '/office/state') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(buildOfficeState(deps)));
    return true;
  }

  const root = deps.webRoot ?? defaultWebRoot();
  if (pathname === '/office' || pathname === '/office/') {
    serveFile(res, path.join(root, 'index.html'));
    return true;
  }

  // /office/<asset> — 净化:先 decode 再判 .. ,再 resolve 校验确实落在 root 内。
  let rel: string;
  try { rel = decodeURIComponent(pathname.slice('/office/'.length)); } catch { rel = pathname.slice('/office/'.length); }
  if (rel.includes('..') || rel.includes('\0') || path.isAbsolute(rel)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return true;
  }
  const abs = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return true;
  }
  serveFile(res, abs);
  return true;
}
