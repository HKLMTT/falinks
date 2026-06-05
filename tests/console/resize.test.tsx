import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';
import { installResizeClear } from '../../src/console/run.js';

// 整屏清除前缀:清屏 + 清滚动区 + 光标归位。窗口变窄时 iTerm2 回流已打印的行,
// 必须在 resize 时整屏擦一次并重置 Ink 帧账,否则增量 eraseLines 擦错位、残留旧 logo。
// 同时:清屏只在 resize 发生,不是每帧——否则 1s 轮询下界面狂闪(本次回归的根因)。
const CLEAR = '\u001B[2J\u001B[3J\u001B[H';

function fakeStdout() {
  const ee = new EventEmitter() as any;
  ee.writes = [] as string[];
  ee.write = (s: string) => { ee.writes.push(String(s)); return true; };
  ee.prependListener = EventEmitter.prototype.prependListener.bind(ee);
  return ee;
}

test('resize 触发:整屏清除 + 重置 Ink 帧账', () => {
  const stdout = fakeStdout();
  let cleared = 0;
  installResizeClear(stdout, () => { cleared++; });

  expect(stdout.writes).toEqual([]); // 安装时不写
  expect(cleared).toBe(0);

  stdout.emit('resize');
  expect(stdout.writes).toEqual([CLEAR]); // resize 时整屏清一次
  expect(cleared).toBe(1);               // 并重置帧账

  stdout.emit('resize');
  expect(stdout.writes).toEqual([CLEAR, CLEAR]); // 每次 resize 各清一次
  expect(cleared).toBe(2);
});

test('用 prependListener:抢在 Ink 自己的 resize 处理之前清屏', () => {
  const stdout = fakeStdout();
  const order: string[] = [];
  stdout.on('resize', () => order.push('ink')); // 模拟 Ink 先注册的处理器
  installResizeClear(stdout, () => order.push('reset')); // 我们后安装,但要先跑

  stdout.emit('resize');
  expect(order).toEqual(['reset', 'ink']); // 清屏+重置在 Ink 重绘之前
});
