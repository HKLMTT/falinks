// 像素办公室 (#15) 端到端验收用的可控状态 mock 服务。
// 用法: node scripts/office-mock.mjs [port]
//   - 绑定 127.0.0.1,默认端口 4317
//   - /office /office/state /office/<asset> 由真实 handleOfficeRequest 提供(webRoot=dist/office/web)
//   - /mock/set?name=&status=&unresponsive=  现场翻状态
//   - /mock/state                            查看当前内存 roster
// 非发布产物,仅供验收。
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleOfficeRequest } from '../dist/office/serve.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB_ROOT = path.join(ROOT, 'dist', 'office', 'web');
const PORT = Number(process.argv[2]) || 4317;
const HOST = '127.0.0.1';

const VALID_STATUS = new Set(['idle', 'busy', 'waiting', 'done', 'offline']);

// 初始覆盖全部状态 + 一个 unresponsive(卡住)成员。
const roster = [
  { name: 'lead', role: '组长,统筹任务分配', status: 'busy', virtual: false, lead: true, unresponsive: false },
  { name: 'frontend', role: '前端开发', status: 'idle', virtual: false, lead: false, unresponsive: false },
  { name: 'backend', role: '后端开发', status: 'busy', virtual: false, lead: false, unresponsive: false },
  { name: 'qa', role: '测试与质量', status: 'waiting', virtual: false, lead: false, unresponsive: false },
  { name: 'ux', role: 'UI/UX 设计走查', status: 'done', virtual: false, lead: false, unresponsive: false },
  { name: 'intern', role: '实习生', status: 'offline', virtual: true, lead: false, unresponsive: false },
  { name: 'stuck', role: '卡住的成员', status: 'busy', virtual: false, lead: false, unresponsive: true },
];

const now = () => Date.now();
const messages = [
  { id: 'm1', from: 'lead', to: 'backend', body: '搭一个可控状态的 office mock 服务', ts: now() - 60000 },
  { id: 'm2', from: 'backend', to: 'lead', body: '收到,正在做', ts: now() - 50000, thread: 'm1' },
  { id: 'm3', from: 'lead', to: 'qa', body: '帮忙验收一下 #15 端到端', ts: now() - 40000 },
  { id: 'm4', from: 'frontend', to: 'lead', body: '前端浮标动画已就绪', ts: now() - 30000 },
];

const questions = [
  { id: 'q1', from: 'qa', question: '验收顺序先测哪个状态切换?', options: ['idle→busy', 'busy→stuck', 'done→offline'], ts: now() - 20000 },
];

const deps = {
  router: {
    roster: () => roster,
    messages: () => messages,
  },
  questions: { list: () => questions },
  webRoot: WEB_ROOT,
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '', `http://${req.headers.host ?? HOST}`);

  // ---- 控制端点(在 handleOfficeRequest 之前拦截)----
  if (url.pathname === '/mock/set') {
    const name = url.searchParams.get('name');
    const status = url.searchParams.get('status');
    const unresponsive = url.searchParams.get('unresponsive');
    const member = roster.find((m) => m.name === name);
    if (!member) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: `no such member: ${name}` }));
      return;
    }
    if (status !== null) {
      if (!VALID_STATUS.has(status)) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: `bad status: ${status}`, valid: [...VALID_STATUS] }));
        return;
      }
      member.status = status;
    }
    if (unresponsive !== null) member.unresponsive = unresponsive === '1' || unresponsive === 'true';
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, member }));
    return;
  }

  if (url.pathname === '/mock/state') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ roster }, null, 2));
    return;
  }

  // ---- 真实办公室路由 ----
  if (handleOfficeRequest(req, res, deps)) return;

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(PORT, HOST, () => {
  console.log(`[office-mock] webRoot = ${WEB_ROOT}`);
  console.log(`[office-mock] 办公室:   http://${HOST}:${PORT}/office`);
  console.log(`[office-mock] state:    http://${HOST}:${PORT}/office/state`);
  console.log(`[office-mock] 翻状态:   http://${HOST}:${PORT}/mock/set?name=frontend&status=busy&unresponsive=0`);
  console.log(`[office-mock] 查内存:   http://${HOST}:${PORT}/mock/state`);
});
