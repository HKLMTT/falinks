import { EventEmitter } from 'node:events';
import React from 'react';
import { render } from 'ink';
import { expect, test } from 'vitest';
import { App } from '../../src/console/app.js';

// 防闪烁不变式:控制台输出高度必须严格小于终端行数。
// 一旦 ≥ 行数,Ink 每帧走 clearTerminal(2J/3J)整屏清除——配合 1s 轮询重渲染就是持续闪烁。
// 用一个矮终端(8 行)渲染:内容(logo+花名册+输入区)天然超过 8 行,
// 若不做视口裁剪,Ink 必然整屏清除 → 本测试红;裁剪到 rows-1 后走增量 → 绿。
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

test('矮终端下输出被裁进视口:任何帧都不整屏清除(2J/3J)', async () => {
  const stdout = fakeStdout(80, 8);
  const stdin = fakeStdin();
  const inst = render(<App port={1} />, { stdout, stdin, exitOnCtrlC: false, patchConsole: false });
  try {
    await new Promise((r) => setTimeout(r, 150)); // 等首帧+一轮重渲染
    expect(stdout.frames.length).toBeGreaterThan(0);
    for (const f of stdout.frames as string[]) {
      expect(f.includes('[2J')).toBe(false);
      expect(f.includes('[3J')).toBe(false);
    }
    // 且每帧行数 ≤ rows-1(+1 个尾随换行)
    for (const f of stdout.frames as string[]) {
      const body = f.replace(/\[[0-9;]*[A-Za-z]/g, ''); // 去转义序列后数行
      expect(body.split('\n').length).toBeLessThanOrEqual(8); // 7 行内容 + 尾随换行
    }
  } finally {
    inst.unmount();
  }
});
