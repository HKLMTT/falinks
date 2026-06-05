import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { realpathSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs';

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
export function consoleLaunchCommand(selfScript: string, execPath: string, port?: number): string {
  const suffix = port ? ` --port ${port}` : '';
  return selfScript.endsWith('.ts')
    ? `npx tsx ${selfScript} console${suffix}`
    : `${execPath} ${selfScript} console${suffix}`;
}

/** 运行中的办公室实例档案:~/.falinks/runtime/<projectKey>.json。 */
export interface InstanceInfo { port: number; pid: number; cwd: string; startedAt: number; }

/** cwd 的规范形(realpath,失败回退原值)——所有 hash 前必须先过这层,防符号链接路径对不上。 */
export function realCwd(cwd: string): string {
  try { return realpathSync(cwd); } catch { return cwd; }
}

/** 项目 key:sha1(realpath(cwd)) 前 16 位。与 sessions/messages 的 hash 模式一致。 */
export function projectKey(cwd: string): string {
  return createHash('sha1').update(realCwd(cwd)).digest('hex').slice(0, 16);
}

export function instancePath(cwd: string, root = runtimeDir()): string {
  return join(root, 'runtime', `${projectKey(cwd)}.json`);
}

/** 写实例档案。默认 wx 排他创建(挡同目录双开竞态),已存在返回 false;force 覆盖。 */
export function writeInstance(info: InstanceInfo, root = runtimeDir(), opts?: { force?: boolean }): boolean {
  const p = instancePath(info.cwd, root);
  mkdirSync(join(root, 'runtime'), { recursive: true });
  try {
    writeFileSync(p, JSON.stringify(info), { flag: opts?.force ? 'w' : 'wx' });
    return true;
  } catch (e: any) {
    if (e?.code === 'EEXIST') return false;
    throw e;
  }
}

/** 读实例档案;不存在或损坏返回 null。 */
export function readInstance(cwd: string, root = runtimeDir()): InstanceInfo | null {
  try {
    const d = JSON.parse(readFileSync(instancePath(cwd, root), 'utf8'));
    return typeof d?.port === 'number' ? d : null;
  } catch { return null; }
}

/** 删除实例档案,但只删自己的(pid 匹配)——退出清理用,防误删后启实例的档案。 */
export function removeInstanceIfOwner(cwd: string, pid: number, root = runtimeDir()): void {
  const i = readInstance(cwd, root);
  if (i?.pid !== pid) return;
  try { unlinkSync(instancePath(cwd, root)); } catch { /* 已不在,无所谓 */ }
}

/** 无条件删除实例档案(stale 清理用)。 */
export function removeInstanceFile(file: string): void {
  try { unlinkSync(file); } catch { /* ignore */ }
}

/** 列出全部实例档案(损坏的跳过)。 */
export function listInstances(root = runtimeDir()): { file: string; info: InstanceInfo }[] {
  let names: string[];
  try { names = readdirSync(join(root, 'runtime')).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out: { file: string; info: InstanceInfo }[] = [];
  for (const n of names) {
    const file = join(root, 'runtime', n);
    try {
      const d = JSON.parse(readFileSync(file, 'utf8'));
      if (typeof d?.port === 'number' && typeof d?.cwd === 'string') out.push({ file, info: d });
    } catch { /* 损坏跳过 */ }
  }
  return out;
}
