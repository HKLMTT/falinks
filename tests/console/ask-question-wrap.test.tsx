// tests/console/ask-question-wrap.test.tsx
// 回归:lead 用 ask 向 boss 提问时,长问题/长选项必须完整折行可见,不被单行截断。
// 渲染级 e2e(依赖 Ink 调度 + HTTP 轮询),CI 下时序不稳,故仅本地跑。
import { EventEmitter } from 'node:events';
import React from 'react';
import { render } from 'ink';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { App } from '../../src/console/app.js';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';
import { setLocale } from '../../src/i18n/index.js';

function fakeStdout(columns: number, rows: number) {
  const out = new EventEmitter() as any;
  out.columns = columns; out.rows = rows; out.isTTY = true;
  out.frames = [] as string[];
  out.write = (s: string) => { out.frames.push(String(s)); return true; };
  return out;
}
function fakeStdin() {
  const sin = new EventEmitter() as any;
  sin.isTTY = true;
  for (const m of ['setRawMode', 'setEncoding', 'ref', 'unref', 'resume', 'pause']) sin[m] = () => sin;
  sin.read = () => null;
  return sin;
}
const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
async function waitFor(pred: () => boolean, timeout = 8000, step = 25): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (pred()) return; await new Promise((r) => setTimeout(r, step)); }
  if (!pred()) throw new Error('waitFor: 超时未满足条件');
}

let bus: Bus;
let router: Router;

beforeEach(async () => {
  setLocale('zh');
  const driver = new FakeDriver();
  let n = 0;
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}`, routes: {} });
  router.addAgent('lead', undefined, true);
  router.addVirtual('boss');
  router.register('lead', await driver.launch({ cwd: '/l', command: 'cat' }));
  bus = await startBus({ router, getSessionId: () => undefined }, 0);
});
afterEach(async () => { await bus.close(); });

async function askBoss(question: string, options: string[]) {
  const c = new Client({ name: 'c-lead', version: '1' }, { capabilities: {} });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${bus.port}/agent/lead/mcp`)));
  await c.callTool({ name: 'ask', arguments: { to: 'boss', question, options } });
  await c.close();
}

const renderE2E = test.skipIf(!!process.env.CI);

renderE2E('长问题与长选项完整折行可见(不被单行截断)', async () => {
  // 问题/选项都远超终端宽度,带唯一尾标记;truncate-end 下尾标记会被切掉,wrap 下应可见。
  const qTail = '问题尾部唯一标记QEND';
  const oTail = '选项尾部唯一标记OEND';
  const longQ = '硬编码中文盘点后发现' + '需要逐项确认的细节'.repeat(12) + qTail;
  const longO = '整页全做方案' + '含正则hint与样本body'.repeat(8) + oTail;
  await askBoss(longQ, [longO, '只做已审定的部分']);

  const stdout = fakeStdout(120, 50);
  const inst = render(<App port={bus.port} />, { stdout, stdin: fakeStdin(), exitOnCtrlC: false, patchConsole: false });
  const allText = () => strip((stdout.frames as string[]).join('\n'));
  try {
    // App 轮询 /admin/questions → 进答题态 → 渲染选择器;等问题正文出现
    await waitFor(() => allText().includes('问题尾部唯一标记QEND') || allText().includes('问你'));
    const text = allText();
    expect(text).toContain(qTail); // 问题尾部可见 = 完整折行,未被截断
    expect(text).toContain(oTail); // 选项尾部可见 = 选项也完整折行
  } finally {
    inst.unmount();
  }
});
