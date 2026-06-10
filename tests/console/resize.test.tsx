import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';
import { installResizeClear } from '../../src/console/run.js';

// resize 清屏前缀:只清可视屏 + 光标归位,不带 3J。窗口变窄时 iTerm2 回流已打印的行,
// 必须在 resize 时擦一次可视屏并重置 Ink 帧账,否则增量 eraseLines 擦错位、残留旧 logo。
// 但不清 scrollback(3J)——历史在终端原生滚动区里,清了就再也滚不回去(Claude Code 同款取舍)。
// 同时:清屏只在 resize 发生,不是每帧——否则 1s 轮询下界面狂闪(本次回归的根因)。
const CLEAR_SCREEN = '[2J[H';

function fakeStdout() {
  const ee = new EventEmitter() as any;
  ee.writes = [] as string[];
  ee.write = (s: string) => { ee.writes.push(String(s)); return true; };
  ee.prependListener = EventEmitter.prototype.prependListener.bind(ee);
  return ee;
}

test('resize 触发:清可视屏(不清 scrollback)+ 重置 Ink 帧账', () => {
  const stdout = fakeStdout();
  let cleared = 0;
  installResizeClear(stdout, () => { cleared++; });

  expect(stdout.writes).toEqual([]); // 安装时不写
  expect(cleared).toBe(0);

  stdout.emit('resize');
  expect(stdout.writes).toEqual([CLEAR_SCREEN]); // resize 时清一次可视屏
  expect(stdout.writes[0]).not.toContain('[3J'); // 决不清 scrollback:历史要能滚回去
  expect(cleared).toBe(1);                       // 并重置帧账

  stdout.emit('resize');
  expect(stdout.writes).toEqual([CLEAR_SCREEN, CLEAR_SCREEN]); // 每次 resize 各清一次
  expect(cleared).toBe(2);
});

test('用 prependListener:抢在 Ink 自己的 resize 处理之前清屏', () => {
  const stdout = fakeStdout();
  const order: string[] = [];
  stdout.on('resize', () => order.push('ink')); // 模拟 Ink 先注册的处理器
  installResizeClear(stdout, () => order.push('reset')); // 我们后安装,但要先跑

  stdout.emit('resize');
  expect(order).toEqual(['reset', 'ink']);
});
