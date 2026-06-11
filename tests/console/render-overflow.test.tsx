import { EventEmitter } from 'node:events';
import React from 'react';
import { render } from 'ink';
import stringWidth from 'string-width';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { App } from '../../src/console/app.js';
import { dispWidth, wrapSegs } from '../../src/console/scrollback.js';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';
import { setLocale } from '../../src/i18n/index.js';

/**
 * 渲染残影(宽符号溢出)回归测试 —— 锁定 alt-screen 自绘方案的几何不变式:
 * **每屏幕行真实显示宽 ≤ cols-1,活区 1 UI 行=1 屏幕行**。打破任意一条 → 帧物理高度
 * 超 rows-1 → 顶滚 → log-update 擦除错位 → 残影逐帧累积(实机同一行 ×35)。
 *
 * 修复(对应 Phase-1 结论的三件套):
 * 1. scrollback.ts cpWidth() 补齐 East Asian Wide 的 BMP 符号单字区段
 *    (⏳ U+23F3、✅ U+2705、❌ U+274C 等)——与 Ink string-width/iTerm 对齐按 2 算,
 *    wrapSegs 不再超额打包。
 * 2. 根盒宽度收到 cols-1:Ink 的截断边界=cols-1,决不产出恰满屏宽(=cols)的行
 *    (=cols 触发 iTerm 行尾 pending-wrap,>cols 直接物理折行)。
 * 3. 底部活区所有单行 UI <Text> 统一 wrap="truncate-end";pendingDeliver 的目标名单
 *    先按显示宽 clipDisp 预截,保住行尾 "Esc 取消排队" 操作提示。
 */

// ── 纯单测:宽度表本身(确定性,CI 也跑) ──────────────────────────────

test('dispWidth:East Asian Wide 符号区(⏳✅❌)应为 2', () => {
  expect(dispWidth('⏳')).toBe(2); // U+23F3 EAW=W
  expect(dispWidth('✅')).toBe(2); // U+2705 EAW=W
  expect(dispWidth('❌')).toBe(2); // U+274C EAW=W
});

test('wrapSegs:打包出的每一屏幕行真实 string-width 不得超过给定宽度', () => {
  // todolist 汇总消息风格的真实场景正文(✅❌⏳ + 中文)
  const body = '汇总:✅任务一完成 ❌任务二失败 ✅任务三完成 ⏳任务四等待中 ✅任务五完成 ❌任务六失败 ✅任务七完成 中文中文中文中文';
  const width = 77; // cols=80 时历史区正文宽度:cols-1-2(缩进)
  for (const row of wrapSegs([{ text: body }], width)) {
    const text = row.map((s) => s.text).join('');
    // cpWidth 若低估 ⏳✅❌(各 -1)会把首行打包到真实宽 82 > 77 —— 修复后必须吻合
    expect(stringWidth(text)).toBeLessThanOrEqual(width);
  }
});

// ── e2e:真实 <App> 渲染帧的几何不变式(沿用 app-e2e 的 harness;CI 跳过渲染层) ──

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
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, step));
  }
  if (!pred()) throw new Error('waitFor: 超时未满足条件');
}

let bus: Bus; let driver: FakeDriver; let router: Router;
const sessions = new Map<string, string>();
const NAMES = ['frontend', 'backend', 'qa-tester', 'designer', 'devops', 'writer'];

beforeEach(async () => {
  setLocale('zh');
  driver = new FakeDriver();
  let n = 0;
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}`, routes: {} });
  for (const nm of NAMES) {
    router.addAgent(nm);
    sessions.set(nm, await driver.launch({ cwd: '/' + nm, command: 'cat' }));
    router.register(nm, sessions.get(nm)!);
  }
  router.addVirtual('boss');
  bus = await startBus({ router, getSessionId: (nm) => sessions.get(nm) }, 0);
});
afterEach(async () => { await bus.close(); });

// 渲染层 e2e 同 app-e2e:headless CI 时序不稳,仅本地跑。
const renderE2E = test.skipIf(!!process.env.CI);

renderE2E('e2e:含 ✅❌⏳ 消息下任何帧的任何行 string-width ≤ cols-1(防物理折行顶滚)', async () => {
  const COLS = 80, ROWS = 20;
  // 历史区回归点:wrapSegs(cpWidth) 曾超额打包 → truncate-end 截到 cols=80(恰满屏宽,> 设计余量 79)
  router.send('boss', 'frontend', '汇总:✅任务一完成 ❌任务二失败 ✅任务三完成 ⏳任务四等待中 ✅任务五完成 ❌任务六失败 ✅任务七完成 中文中文中文中文');

  const stdout = fakeStdout(COLS, ROWS);
  const inst = render(<App port={bus.port} />, { stdout, stdin: fakeStdin(), exitOnCtrlC: false, patchConsole: false });
  const lastFrame = () => (stdout.frames as string[]).map(strip).filter((x) => x.trim()).at(-1) ?? '';
  try {
    await waitFor(() => lastFrame().includes('汇总'));
    for (const line of lastFrame().split('\n')) {
      // 恰好 =cols 的行让 iTerm 进入行尾 pending-wrap 状态;>cols 直接物理折行 → 整帧比 rows-1 高
      // → 顶滚 → Ink 擦除错位 → 顶部残影累积。alt-screen 方案要求每行 ≤ cols-1。
      expect.soft(stringWidth(line), `超宽行: ${JSON.stringify(line)}`).toBeLessThanOrEqual(COLS - 1);
    }
  } finally {
    inst.unmount();
  }
});

renderE2E('e2e:pendingDeliver 长名单必须保持单物理行,且行尾操作提示可见', async () => {
  const COLS = 80, ROWS = 20;
  // 每人 1 条占住(busy)+ 3 条排队 → 6 目标 ×N 的长 pending 行(完整 string-width 114 > 80)
  for (const nm of NAMES) router.send('boss', nm, '占住-' + nm);
  for (const nm of NAMES) for (let i = 0; i < 3; i++) router.send('boss', nm, `排队-${nm}-${i}`);

  const stdout = fakeStdout(COLS, ROWS);
  const inst = render(<App port={bus.port} />, { stdout, stdin: fakeStdin(), exitOnCtrlC: false, patchConsole: false });
  const lastFrame = () => (stdout.frames as string[]).map(strip).filter((x) => x.trim()).at(-1) ?? '';
  try {
    await waitFor(() => lastFrame().includes('等送达'));
    const line = lastFrame().split('\n').find((l) => l.includes('等送达'))!;
    // 回归点 1:曾被 Ink 默认 wrap 折两行,行尾 "Esc 取消排队" 掉到下一物理行,
    // 活区"1 UI 行=1 屏幕行"假设失效。现在目标名单按显示宽 clipDisp 预截,提示保住。
    expect(line).toContain('取消排队');
    // 回归点 2:单行且 ≤ cols-1(truncate-end + 根盒 cols-1 兜底)。
    expect(stringWidth(line)).toBeLessThanOrEqual(COLS - 1);
  } finally {
    inst.unmount();
  }
});
