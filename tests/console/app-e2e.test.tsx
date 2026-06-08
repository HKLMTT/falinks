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
// 验证「花名册状态本地化」与「消息投递徽标(排队中/已送达)」整条链路(router→/admin/log queued→fetch→deliveryState→JSX)。

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
// 默认 5s 用例超时)。功能逻辑已被确定性单测全覆盖(deliveryState / queuedMessageIds / moveSel /
// windowRange / keys(PageUp) / agentStatus / historyCap)+ 下面 HTTP 级 queued 翻转 e2e,
// 故"渲染层" e2e 仅本地跑、CI 跳过(CI=true 时)。本地用于盯整条 JSX 链路。
const renderE2E = test.skipIf(!!process.env.CI);

renderE2E('e2e:花名册状态本地化 + 消息徽标(排队中/已送达)真实渲染', async () => {
  router.send('boss', 'alice', 'first');   // alice idle → 即时投递 → 已送达, alice 转 busy
  router.send('boss', 'alice', 'second');  // alice busy → 入队 → 排队中
  router.send('alice', 'boss', 'report');  // 发给虚拟 boss → 不显示徽标

  const stdout = fakeStdout(140, 60); // 高终端:内容不被视口裁剪
  const inst = render(<App port={bus.port} />, { stdout, stdin: fakeStdin(), exitOnCtrlC: false, patchConsole: false });
  const allText = () => strip((stdout.frames as string[]).join('\n')); // 所有帧累积文本(出现过即可)
  try {
    // 等首轮轮询拉到 /admin/roster + /admin/log 并渲染(条件等待,不靠固定 sleep)
    await waitFor(() => ['工作中', '空闲', '排队中', '已送达'].every((s) => allText().includes(s)));
    const text = allText();
    expect(text).toContain('工作中');     // 花名册:alice 忙 → 工作中
    expect(text).toContain('空闲');       // bob 闲 → 空闲
    expect(text).not.toMatch(/\[busy\]|\[idle\]/); // 不再是英文原始状态
    expect(text).toContain('排队中');     // 排队的 second
    expect(text).toContain('已送达');     // 已投递的 first
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

renderE2E('e2e:PageUp 回看翻看更早消息 + Enter 展开折叠正文', async () => {
  for (let i = 1; i <= 12; i++) {
    const body = i === 4 ? 'L1\nL2\nL3\nL4\nL5' : `MSG-${String(i).padStart(2, '0')}`;
    router.send('boss', 'alice', body);
    router.onIdle('alice'); // 投出 → 回 idle,下一条也即时投递(都进 log)
  }
  const stdout = fakeStdout(140, 60);
  const stdin = fakeStdin();
  const inst = render(<App port={bus.port} />, { stdout, stdin, exitOnCtrlC: false, patchConsole: false });
  const stdinAny = stdin as any;
  const allText = () => strip((stdout.frames as string[]).join('\n'));
  // 最近一帧"完整渲染"(含 logo 框线 ╔)的文本 —— 用于"当前态"断言(如退出回看后不应再有指示条)。
  const lastContent = () => {
    const frames = (stdout.frames as string[]).map(strip).filter((f) => f.includes('╔'));
    return frames.length ? frames[frames.length - 1] : '';
  };
  const press = async (seq: string) => { stdinAny.emit('data', Buffer.from(seq)); await new Promise((r) => setTimeout(r, 20)); };
  try {
    await waitFor(() => allText().includes('MSG-12')); // 首轮轮询:实时态见尾部

    // PageUp 进入回看(拉全量),逐条往上选;每按一次等指示条"第 pos/12"出现以确保已生效。
    await press('\x1b[5~');
    await waitFor(() => allText().includes('第 12/12')); // 进入,选中最新(MSG-12)
    for (let pos = 11; pos >= 4; pos--) { // 再上翻 8 次 → 选到 MSG-04
      await press('\x1b[5~');
      await waitFor(() => allText().includes(`第 ${pos}/12`));
    }

    await waitFor(() => allText().includes('MSG-01')); // 看到了实时尾部之外的更早消息
    expect(allText()).toContain('回看中');           // 指示条
    expect(allText()).not.toContain('L5');           // MSG-04 此刻折叠,第 5 行还没出现过

    await press('\r');                               // Enter 展开选中的 MSG-04
    await waitFor(() => allText().includes('L5'));   // 展开后看到全文

    await press('\x1b');                             // Esc 退出回看
    await waitFor(() => !lastContent().includes('回看中')); // 当前帧不再有指示条
  } finally {
    inst.unmount();
  }
});


