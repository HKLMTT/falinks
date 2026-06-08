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

test('e2e:花名册状态本地化 + 消息徽标(排队中/已送达)真实渲染', async () => {
  router.send('boss', 'alice', 'first');   // alice idle → 即时投递 → 已送达, alice 转 busy
  router.send('boss', 'alice', 'second');  // alice busy → 入队 → 排队中
  router.send('alice', 'boss', 'report');  // 发给虚拟 boss → 不显示徽标

  const stdout = fakeStdout(140, 60); // 高终端:内容不被视口裁剪
  const inst = render(<App port={bus.port} />, { stdout, stdin: fakeStdin(), exitOnCtrlC: false, patchConsole: false });
  try {
    await new Promise((r) => setTimeout(r, 1500)); // 等首轮轮询拉到 /admin/roster + /admin/log
    const text = strip((stdout.frames as string[]).join('\n'));

    // 花名册状态本地化(zh):alice 忙 → 工作中, bob 闲 → 空闲(非英文 idle/busy)
    expect(text).toContain('工作中');
    expect(text).toContain('空闲');
    expect(text).not.toMatch(/\[busy\]|\[idle\]/);

    // 消息徽标:排队的 second → 排队中;已投递的 first → 已送达
    expect(text).toContain('排队中');
    expect(text).toContain('已送达');
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

test('e2e:PageUp 回看翻看更早消息 + Enter 展开折叠正文', async () => {
  for (let i = 1; i <= 12; i++) {
    const body = i === 4 ? 'L1\nL2\nL3\nL4\nL5' : `MSG-${String(i).padStart(2, '0')}`;
    router.send('boss', 'alice', body);
    router.onIdle('alice'); // 投出 → 回 idle,下一条也即时投递(都进 log)
  }
  const stdout = fakeStdout(140, 60);
  const stdin = fakeStdin();
  const inst = render(<App port={bus.port} />, { stdout, stdin, exitOnCtrlC: false, patchConsole: false });
  const stdinAny = stdin as any;
  const press = async (seq: string, ms = 70) => { stdinAny.emit('data', Buffer.from(seq)); await new Promise((r) => setTimeout(r, ms)); };
  const lastFrame = () => strip(((stdout.frames as string[]).at(-1)) ?? '');
  try {
    await new Promise((r) => setTimeout(r, 400)); // 首轮轮询
    // 实时态:只见尾部(MSG-12 在,MSG-01 不在)
    expect(lastFrame()).toContain('MSG-12');

    await press('\x1b[5~', 300); // PageUp 进入回看(拉全量)
    for (let k = 0; k < 8; k++) await press('\x1b[5~'); // 选到 MSG-04(越过实时尾部)
    const browsed = lastFrame();
    expect(browsed).toContain('回看中');   // 指示条
    expect(browsed).toContain('MSG-01');   // 看到了实时尾部之外的更早消息
    expect(browsed).not.toContain('L5');   // MSG-04 此刻折叠,看不到第 5 行

    await press('\r'); // Enter 展开选中的 MSG-04
    expect(lastFrame()).toContain('L5');   // 展开后看到全文

    await press('\x1b'); // Esc 退出回看
    await new Promise((r) => setTimeout(r, 400));
    expect(lastFrame()).not.toContain('回看中');
  } finally {
    inst.unmount();
  }
});


