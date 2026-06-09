import { EventEmitter } from 'node:events';
import React from 'react';
import { render } from 'ink';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { App } from '../../src/console/app.js';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';
import { setLocale } from '../../src/i18n/index.js';

// 端到端:真 bus + 真 Router → 渲染真实控制台 <App> → 读帧文本,
// 验证「消息历史提交进终端原生 scrollback(<Static>)」与「底部活区花名册 statusline」整条链路。

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

// 条件等待:轮询 pred 直到为真或超时(CI 比本地慢,固定 sleep 会 flaky)。
async function waitFor(pred: () => boolean, timeout = 8000, step = 25): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, step));
  }
  if (!pred()) throw new Error('waitFor: 超时未满足条件');
}

let bus: Bus; let driver: FakeDriver; let router: Router;
const sessions = new Map<string, string>();

beforeEach(async () => {
  setLocale('zh');
  driver = new FakeDriver();
  let n = 0;
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}`, routes: {} });
  router.addAgent('alice'); router.addAgent('bob'); router.addVirtual('boss');
  sessions.set('alice', await driver.launch({ cwd: '/a', command: 'cat' }));
  sessions.set('bob', await driver.launch({ cwd: '/b', command: 'cat' }));
  router.register('alice', sessions.get('alice')!); // idle
  router.register('bob', sessions.get('bob')!);     // idle
  bus = await startBus({ router, getSessionId: (nm) => sessions.get(nm) }, 0);
});
afterEach(async () => { await bus.close(); });

// 两个"真实渲染" e2e 依赖 Ink 渲染调度 + 1s HTTP 轮询,headless CI 下时序不稳(首帧空/轮询慢于
// 默认 5s 用例超时)。功能逻辑已被确定性单测全覆盖(scrollback / queuedMessageIds /
// keys / agentStatus / historyCap)+ 下面 HTTP 级 queued 翻转 e2e,
// 故"渲染层" e2e 仅本地跑、CI 跳过(CI=true 时)。本地用于盯整条 JSX 链路。
const renderE2E = test.skipIf(!!process.env.CI);

renderE2E('e2e:消息提交进 scrollback(<Static>)+ 底部活区花名册 statusline', async () => {
  router.send('boss', 'alice', 'hello-alice');  // alice idle → 即时投递 → busy
  router.send('boss', 'bob', 'hello-bob');       // bob idle → 即时投递

  const stdout = fakeStdout(140, 60); // 高终端:内容不被视口裁剪
  const inst = render(<App port={bus.port} />, { stdout, stdin: fakeStdin(), exitOnCtrlC: false, patchConsole: false });
  const allText = () => strip((stdout.frames as string[]).join('\n')); // 所有帧累积文本(出现过即可)
  try {
    // 等首轮轮询拉到 /admin/roster + /admin/log 并渲染(条件等待,不靠固定 sleep)
    await waitFor(() => ['hello-alice', 'hello-bob', 'alice', 'bob'].every((s) => allText().includes(s)));
    const text = allText();
    expect(text).toContain('hello-alice'); // 消息提交进 scrollback
    expect(text).toContain('hello-bob');
    expect(text).toContain('alice');       // 花名册 statusline 含成员名
    expect(text).toContain('bob');
  } finally {
    inst.unmount();
  }
});

test('e2e(HTTP):/admin/log 的 queued 随投递翻转(排队中 → 已送达)', async () => {
  router.send('boss', 'alice', 'first');         // 即时投递 → alice busy
  const m2 = router.send('boss', 'alice', 'second')!; // 入队
  const log1 = await (await fetch(`http://127.0.0.1:${bus.port}/admin/log`)).json();
  expect(log1.log.find((m: any) => m.id === m2.id).queued).toBe(true); // 排队中

  router.onIdle('alice'); // alice 干完 → pump 投出 second
  const log2 = await (await fetch(`http://127.0.0.1:${bus.port}/admin/log`)).json();
  expect(log2.log.find((m: any) => m.id === m2.id).queued).toBe(false); // 已送达
});

