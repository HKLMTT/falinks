import { afterEach, beforeEach, expect, test } from 'vitest';
import http from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildOfficeState, handleOfficeRequest } from '../../src/office/serve.js';

function fakeDeps(over: any = {}) {
  const roster = over.roster ?? [
    { name: 'lead', role: '组长', status: 'busy', virtual: false, lead: true, unresponsive: false },
    { name: 'boss', role: '老板', status: 'idle', virtual: true, lead: false, unresponsive: false },
  ];
  const messages = over.messages ?? [
    { id: 'm1', from: 'lead', to: 'backend', body: 'hi', ts: 1 },
    { id: 'm2', from: 'backend', to: 'lead', body: 'ok', ts: 2 },
  ];
  const questions = over.questions ?? [
    { id: 'q1', from: 'qa', question: '上线?', options: ['是', '否'], ts: 5 },
  ];
  return {
    router: {
      roster: () => roster.map((a: any) => ({ ...a })),
      messages: () => messages.map((m: any) => ({ ...m })),
    },
    questions: { list: () => questions.map((q: any) => ({ ...q })) },
    webRoot: over.webRoot,
    now: over.now ?? (() => 999),
  };
}

test('buildOfficeState 字段齐全', () => {
  const s = buildOfficeState(fakeDeps());
  expect(s.ts).toBe(999);
  expect(s.roster).toEqual([
    { name: 'lead', role: '组长', status: 'busy', virtual: false, lead: true, unresponsive: false },
    { name: 'boss', role: '老板', status: 'idle', virtual: true, lead: false, unresponsive: false },
  ]);
  expect(s.log).toEqual([
    { id: 'm1', from: 'lead', to: 'backend', body: 'hi', ts: 1 },
    { id: 'm2', from: 'backend', to: 'lead', body: 'ok', ts: 2 },
  ]);
  expect(s.questions).toEqual([{ id: 'q1', from: 'qa', question: '上线?', options: ['是', '否'], ts: 5 }]);
});

test('log 截断为最近 200 条且时间升序', () => {
  const messages = Array.from({ length: 250 }, (_, i) => ({ id: `m${i}`, from: 'a', to: 'b', body: String(i), ts: i }));
  const s = buildOfficeState(fakeDeps({ messages }));
  expect(s.log.length).toBe(200);
  expect(s.log[0].id).toBe('m50');
  expect(s.log[199].id).toBe('m249');
  expect(s.log[0].ts).toBeLessThan(s.log[199].ts);
});

test('roster 缺省 role 归一为空串', () => {
  const s = buildOfficeState(fakeDeps({ roster: [{ name: 'x', status: 'idle' }] }));
  expect(s.roster[0]).toEqual({ name: 'x', role: '', status: 'idle', virtual: false, lead: false, unresponsive: false });
});

// ---- 静态服务 / 穿越防护(用真 http server + fetch) ----
let server: http.Server;
let port: number;
let webRoot: string;

beforeEach(async () => {
  webRoot = mkdtempSync(path.join(tmpdir(), 'office-web-'));
  writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>office</title>');
  writeFileSync(path.join(webRoot, 'office.css'), 'body{}');
  mkdirSync(path.join(webRoot, 'assets'));
  writeFileSync(path.join(webRoot, 'assets', 'a.js'), 'console.log(1)');
  // 穿越目标:web 之外的"机密"
  writeFileSync(path.join(webRoot, '..', 'secret.txt'), 'TOPSECRET');

  const deps = fakeDeps({ webRoot });
  server = http.createServer((req, res) => {
    if (handleOfficeRequest(req, res, deps)) return;
    res.writeHead(404); res.end('fallthrough');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as any).port;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(webRoot, { recursive: true, force: true });
  rmSync(path.join(webRoot, '..', 'secret.txt'), { force: true });
});

test('GET /office 返回 index.html', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/office`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/text\/html/);
  expect(await res.text()).toContain('<title>office</title>');
});

test('GET /office/state 返回 JSON', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/office/state`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/application\/json/);
  const j = await res.json();
  expect(j.roster[0].name).toBe('lead');
  expect(Array.isArray(j.log)).toBe(true);
});

test('GET /office/office.css 带正确 content-type', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/office/office.css`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/text\/css/);
});

test('GET /office/assets/a.js 子目录可服务', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/office/assets/a.js`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/javascript/);
});

test('路径穿越被拒(不能读到 web 之外)', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/office/..%2fsecret.txt`);
  expect(res.status).toBe(403);
  expect(await res.text()).not.toContain('TOPSECRET');
});

test('缺失文件 404 友好,不抛', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/office/nope.js`);
  expect(res.status).toBe(404);
});

test('非 office 路径放行(返回 false → 走 fallthrough)', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/admin/roster`);
  expect(await res.text()).toBe('fallthrough');
});
