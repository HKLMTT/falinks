import { EventEmitter } from 'node:events';
import React from 'react';
import { render } from 'ink';
import { expect, test } from 'vitest';
import { App } from '../../src/console/app.js';

// Ink 整屏重绘路径的前缀：清屏 + 清滚动区 + 光标归位（ansi-escapes 的 clearTerminal）。
// 增量重绘（eraseLines）在 iTerm2 窗口变窄回流后会擦错行数，残留旧 logo/错乱换行；
// 只有整屏重绘在机制上不可能留残影，所以 resize 后的重绘必须走这条路径。
const CLEAR_TERMINAL = '\u001B[2J\u001B[3J\u001B[H';

function fakeStdout(columns: number, rows: number) {
  const out = new EventEmitter() as any;
  out.columns = columns;
  out.rows = rows;
  out.isTTY = true;
  out.frames = [] as string[];
  out.write = (s: string) => { out.frames.push(String(s)); return true; };
  return out;
}

function fakeStdin() {
  const sin = new EventEmitter() as any;
  sin.isTTY = true;
  sin.setRawMode = () => sin;
  sin.setEncoding = () => sin;
  sin.ref = () => sin;
  sin.unref = () => sin;
  sin.resume = () => sin;
  sin.pause = () => sin;
  sin.read = () => null;
  return sin;
}

test('窗口 resize 后的重绘走整屏 clearTerminal 路径（不残留旧帧）', async () => {
  const stdout = fakeStdout(100, 40);
  const stdin = fakeStdin();
  const inst = render(<App port={1} />, {
    stdout,
    stdin,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  try {
    // 等首帧渲染落盘
    await new Promise((r) => setTimeout(r, 60));
    expect(stdout.frames.length).toBeGreaterThan(0);

    // 模拟把 pane 拖窄：iTerm2 会回流已打印的行，增量擦除必然错位
    stdout.frames.length = 0;
    stdout.columns = 60;
    stdout.emit('resize');
    await new Promise((r) => setTimeout(r, 60));

    const repaints = stdout.frames as string[];
    expect(repaints.length).toBeGreaterThan(0);
    // resize 后的每一次重绘都必须整屏清除后全量重写
    for (const f of repaints) {
      expect(f.startsWith(CLEAR_TERMINAL)).toBe(true);
    }
  } finally {
    inst.unmount();
  }
});
