import { spawn } from 'node:child_process';

/**
 * 跨平台在系统默认浏览器打开 url。darwin→open / linux→xdg-open / win32→start。
 * 异步 detached 启动并 unref,失败吞掉不抛(打不开浏览器不该让 console 报错)。
 */
export function openBrowser(url: string): void {
  try {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: true });
    // 子进程启动失败(如命令不存在)走 error 事件而非抛异常,挂个空 handler 防 unhandled。
    child.on('error', () => {});
    child.unref();
  } catch {
    // 吞掉:打不开浏览器不影响 console 继续运行。
  }
}
