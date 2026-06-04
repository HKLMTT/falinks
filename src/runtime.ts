import { homedir } from 'node:os';
import { join } from 'node:path';

/** falinks 的运行时目录 ~/.falinks。 */
export function runtimeDir(): string {
  return join(homedir(), '.falinks');
}

/** 运行时状态文件（记录当前总线端口），供 console / 子命令跨目录读取。 */
export function runtimePath(): string {
  return join(runtimeDir(), 'runtime.json');
}

/**
 * 派生"再次调用本 CLI 的 console 子命令"的 shell 命令。
 * dev（tsx 跑 .ts）用 `npx tsx <script> console`；编译后（node 跑 .js）用 `<node> <script> console`。
 */
export function consoleLaunchCommand(selfScript: string, execPath: string): string {
  return selfScript.endsWith('.ts')
    ? `npx tsx ${selfScript} console`
    : `${execPath} ${selfScript} console`;
}
