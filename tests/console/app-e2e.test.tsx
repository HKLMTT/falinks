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
// 验证「消息历史进回看视口(alt screen 全屏自绘)」与「底部活区花名册 statusline」整条链路。

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

renderE2E('e2e:消息进历史视口 + 底部活区花名册 statusline', async () => {
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

renderE2E('e2e:滚轮 burst 进回看(底部活区仍在),Esc 回到最新', async () => {
  for (let i = 1; i <= 30; i++) router.send('boss', 'alice', `历史消息-${i}`); // 远超 12 行视口

  const stdout = fakeStdout(80, 14); // 矮终端:历史必被视口裁剪
  const stdin = fakeStdin();
  const inst = render(<App port={bus.port} />, { stdout, stdin, exitOnCtrlC: false, patchConsole: false });
  // 最后一个**有内容**的帧(Ink 还会写 ?25l 等控制序列小片段,不能直接取 at(-1))。
  const lastFrame = () => (stdout.frames as string[]).map(strip).filter((x) => x.trim()).at(-1) ?? '';
  try {
    await waitFor(() => lastFrame().includes('历史消息-30')); // 实时态:贴底显示最新
    expect(lastFrame()).not.toContain('回看中');

    stdin.emit('data', '\x1b[A\x1b[A\x1b[A'); // 滚轮一格(1007 burst:同 chunk 3 个 ↑)
    await waitFor(() => lastFrame().includes('回看中'));
    expect(lastFrame()).toContain('›'); // 底部输入区钉住不随滚动消失

    for (let i = 0; i < 40; i++) stdin.emit('data', '\x1b[A\x1b[A\x1b[A'); // 滚到顶
    await waitFor(() => lastFrame().includes('历史消息-1'));
    expect(lastFrame()).not.toContain('历史消息-30'); // 最新的已滚出视口

    stdin.emit('data', '\x1b'); // Esc 回底
    await waitFor(() => lastFrame().includes('历史消息-30') && !lastFrame().includes('回看中'));
  } finally {
    inst.unmount();
  }
});


// 全套并发跑时偶发超默认 5s(单跑 <1s),提时限消 flaky。
renderE2E('e2e:Esc 开取消排队浮层,Enter 取消选中条 → 等送达计数缩、历史标已取消', { timeout: 15000 }, async () => {
  router.send('boss', 'alice', '占住-alice');   // 即时投递 → alice busy
  router.send('boss', 'alice', '排队-甲');      // 排队
  router.send('boss', 'alice', '排队-乙');      // 排队

  const stdout = fakeStdout(100, 30);
  const stdin = fakeStdin();
  const inst = render(<App port={bus.port} />, { stdout, stdin, exitOnCtrlC: false, patchConsole: false });
  const lastFrame = () => (stdout.frames as string[]).map(strip).filter((x) => x.trim()).at(-1) ?? '';
  try {
    await waitFor(() => lastFrame().includes('等送达') && lastFrame().includes('×2'));

    stdin.emit('data', '\x1b'); // Esc → 取消排队浮层
    await waitFor(() => lastFrame().includes('排队消息(共'));
    expect(lastFrame()).toContain('排队-甲');
    expect(lastFrame()).toContain('排队-乙');

    stdin.emit('data', '\r'); // Enter 取消选中(第一条:排队-甲)
    try {
      await waitFor(() => lastFrame().includes('已取消 1 条排队消息'));
    } catch (e) {
      console.error('DEBUG cancel frame:', JSON.stringify(lastFrame().split('\n')));
      throw e;
    }
    await waitFor(() => !lastFrame().includes('×2')); // 等送达从 ×2 缩到 1 条
    await waitFor(() => lastFrame().includes('✗已取消')); // 历史行标记

    stdin.emit('data', '\x1b'); // Esc 关浮层(若仍开着)
    await waitFor(() => !lastFrame().includes('排队消息(共'));
  } finally {
    inst.unmount();
  }
});

renderE2E('e2e:浮层按 ! 提升排队消息直送 → 等送达消失、历史标 ⚡直送', { timeout: 15000 }, async () => {
  router.send('boss', 'alice', '占住-alice');   // 即时投递 → alice busy
  router.send('boss', 'alice', '排队-丙');      // 排队

  const stdout = fakeStdout(100, 30);
  const stdin = fakeStdin();
  const inst = render(<App port={bus.port} />, { stdout, stdin, exitOnCtrlC: false, patchConsole: false });
  const lastFrame = () => (stdout.frames as string[]).map(strip).filter((x) => x.trim()).at(-1) ?? '';
  try {
    await waitFor(() => lastFrame().includes('等送达'));

    stdin.emit('data', '\x1b'); // Esc → 排队浮层
    await waitFor(() => lastFrame().includes('排队消息(共'));
    expect(lastFrame()).toContain('排队-丙');

    const before = driver.injections.length;
    stdin.emit('data', '!');    // ! 提升直送
    await waitFor(() => lastFrame().includes('已插队直送'));
    expect(driver.injections.length).toBeGreaterThan(before); // 真注入了(没等 alice 空闲)
    await waitFor(() => !lastFrame().includes('等送达'));      // 排队计数清零
    await waitFor(() => lastFrame().includes('⚡直送'));        // 历史行标记
  } finally {
    inst.unmount();
  }
});
