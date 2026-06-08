import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { KITTY_PUSH, KITTY_POP, MOUSE_POP } from './keys.js';

/** 整屏清除 + 清滚动区 + 光标归位。 */
const CLEAR = '\x1b[2J\x1b[3J\x1b[H';

/**
 * 在 resize 时清屏并重置 Ink 的帧行数账。
 * 用 prependListener 抢在 Ink 自己的 resize 处理之前跑:先把变窄回流的残行(旧 logo/错位换行)
 * 整屏擦掉、并让 Ink 忘记上一帧的行数(否则它按旧宽度 eraseLines 会擦错位),Ink 随后按新宽度
 * 重绘出干净的一帧。注意:不强制根节点占满高度——那会让每帧都整屏重绘,1s 轮询下界面狂闪。
 */
export function installResizeClear(
  stdout: { write: (s: string) => void; prependListener: (event: 'resize', handler: () => void) => void },
  clearFrame: () => void,
): void {
  stdout.prependListener('resize', () => {
    stdout.write(CLEAR);
    clearFrame();
  });
}

/** 在当前进程/终端渲染控制台 TUI。先清屏+清滚动区，盖掉上面的选单/启动日志。 */
export function renderConsole(port: number, initialStatus?: string): void {
  process.stdout.write(CLEAR);
  process.stdout.write(KITTY_PUSH); // 开 kitty 键盘协议：让 Shift+Enter 等修饰键可区分
  // 还原:关 kitty 协议 + 关鼠标上报(App 默认开了鼠标滚轮)。挂到 exit/SIGINT/SIGTERM 多重兜底,
  // 防崩溃/被 kill 时把终端留在鼠标模式(点哪都怪)。MOUSE_POP 幂等,App 自己关过也无妨。
  const restore = () => { try { process.stdout.write(KITTY_POP + MOUSE_POP); } catch { /* ignore */ } };
  process.on('exit', restore);
  process.on('SIGINT', () => { restore(); process.exit(0); });
  process.on('SIGTERM', () => { restore(); process.exit(0); });
  const instance = render(<App port={port} initialStatus={initialStatus} />, { exitOnCtrlC: false }); // Ctrl+C 自行处理：先问是否关闭员工窗口
  installResizeClear(process.stdout, () => instance.clear());
}
