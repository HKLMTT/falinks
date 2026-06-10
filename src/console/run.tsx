import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { KITTY_PUSH, KITTY_POP } from './keys.js';

/**
 * 复刻 Claude Code 全屏渲染(其 2.x 默认):?1049h 进 alternate screen 自绘视口,
 * ?1007h 开 alternate scroll——滚轮被终端转成 ↑/↓ 喂给程序(不开鼠标上报,拖选复制保持原生),
 * App 收到即滚内部回看视口,底部输入区因此能"钉死"。退出还原后终端回到启动前内容。
 */
const ALT_PUSH = '\x1b[?1049h\x1b[?1007h';
const ALT_POP = '\x1b[?1007l\x1b[?1049l';
/** 清可视屏 + 光标归位(alt screen 内无 scrollback 概念,无需也不要 3J)。 */
const CLEAR_SCREEN = '\x1b[2J\x1b[H';

/**
 * 把 Ink 的每次帧写入用 ?2026(synchronized output)包裹:终端攒齐一帧再上屏。
 * alt screen 下根盒钉满屏高,每帧全屏重绘,不包同步标记会在 1s 轮询下肉眼可见地闪。
 * 不支持 2026 的终端会忽略未知模式,无害。
 */
export function syncedStdout(base: NodeJS.WriteStream): NodeJS.WriteStream {
  return new Proxy(base, {
    get(t, p) {
      if (p === 'write') {
        return (chunk: unknown, ...rest: unknown[]) =>
          (t.write as (...a: unknown[]) => boolean)('\x1b[?2026h' + String(chunk) + '\x1b[?2026l', ...rest);
      }
      const v = (t as unknown as Record<PropertyKey, unknown>)[p];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  }) as NodeJS.WriteStream;
}

/**
 * 在 resize 时清屏并重置 Ink 的帧行数账。
 * 用 prependListener 抢在 Ink 自己的 resize 处理之前跑:先把变窄回流的残行(旧 logo/错位换行)
 * 从可视屏擦掉、并让 Ink 忘记上一帧的行数(否则它按旧宽度 eraseLines 会擦错位),Ink 随后按新宽度
 * 重绘出干净的一帧。alt screen 内没有 scrollback,整屏清不丢任何东西。
 */
export function installResizeClear(
  stdout: { write: (s: string) => void; prependListener: (event: 'resize', handler: () => void) => void },
  clearFrame: () => void,
): void {
  stdout.prependListener('resize', () => {
    stdout.write(CLEAR_SCREEN);
    clearFrame();
  });
}

/** 在当前进程/终端渲染控制台 TUI(alt screen 全屏;退出时还原到启动前的终端内容)。 */
export function renderConsole(port: number, initialStatus?: string): void {
  process.stdout.write(ALT_PUSH + CLEAR_SCREEN);
  process.stdout.write(KITTY_PUSH); // 开 kitty 键盘协议:让 Shift+Enter 等修饰键可区分(在 alt screen 内压栈)
  // 还原:先关 kitty 再退 alt screen(顺序不能反——kitty 栈在部分终端按屏幕缓冲区独立)。
  // 挂到 exit/SIGINT/SIGTERM 多重兜底,防崩溃/被 kill 时把终端留在 alt screen 或 kitty 模式。
  const restore = () => { try { process.stdout.write(KITTY_POP + ALT_POP); } catch { /* ignore */ } };
  process.on('exit', restore);
  process.on('SIGINT', () => { restore(); process.exit(0); });
  process.on('SIGTERM', () => { restore(); process.exit(0); });
  const instance = render(<App port={port} initialStatus={initialStatus} />, {
    stdout: syncedStdout(process.stdout),
    exitOnCtrlC: false, // Ctrl+C 自行处理:先问是否关闭员工窗口
  });
  installResizeClear(process.stdout, () => instance.clear());
}
