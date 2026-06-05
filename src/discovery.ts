import { runtimeDir, realCwd, readInstance, removeInstanceFile, instancePath, listInstances } from './runtime.js';
import { t } from './i18n/index.js';

/**
 * 探活三态:alive(确认是 falinks 并拿到身份)/ dead(端口没人听或不是 falinks)/ unknown(超时等,状态不明)。
 * 三态的意义:dead 才能安全清 stale 档案;unknown 必须保守(启动场景拒绝,寻址场景跳过)。
 */
export type Probe =
  | { state: 'alive'; info: { cwd: string; pid: number; startedAt: number } }
  | { state: 'dead' }
  | { state: 'unknown' };

function isConnRefused(e: any): boolean {
  const c = e?.cause;
  if (!c) return false;
  if (c.code === 'ECONNREFUSED') return true;
  return Array.isArray(c.errors) && c.errors.some((x: any) => x?.code === 'ECONNREFUSED');
}

export async function probeBus(port: number, fetchFn: typeof fetch = fetch, timeoutMs = 500): Promise<Probe> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(`http://127.0.0.1:${port}/admin/info`, { signal: ac.signal });
    if (!res.ok) return { state: 'dead' }; // 端口被非 falinks 服务占着
    let info: any;
    try {
      info = await res.json();
    } catch (e: any) {
      if (e?.name === 'SyntaxError') return { state: 'dead' }; // 200 + 非 JSON = 不是 falinks
      throw e;
    }
    if (typeof info?.cwd !== 'string' || typeof info?.pid !== 'number') return { state: 'dead' };
    return { state: 'alive', info };
  } catch (e: any) {
    return isConnRefused(e) ? { state: 'dead' } : { state: 'unknown' };
  } finally {
    clearTimeout(t);
  }
}

export type Resolved = { ok: true; port: number } | { ok: false; error: string };

/**
 * 按 cwd 找运行中的总线:
 * ① 本项目档案(探活+核对 cwd,防端口复用劫持)→ 命中;
 * ② 扫全部档案,恰好一个活的 → 借用(保住"任意目录 falinks roster"的旧体验);
 * 多个 → 列出 cwd 报错;零个 → "找不到"。扫描顺手删确认死亡/张冠李戴的 stale 档案(自愈)。
 */
export async function resolveBus(
  cwd: string,
  opts?: { root?: string; fetchFn?: typeof fetch; timeoutMs?: number },
): Promise<Resolved> {
  const root = opts?.root ?? runtimeDir();
  const fetchFn = opts?.fetchFn ?? fetch;
  const timeoutMs = opts?.timeoutMs;
  const me = realCwd(cwd);

  const mine = readInstance(cwd, root);
  if (mine) {
    const p = await probeBus(mine.port, fetchFn, timeoutMs ?? 500);
    if (p.state === 'alive' && p.info.cwd === me) return { ok: true, port: mine.port };
    if (p.state === 'dead' || p.state === 'alive') removeInstanceFile(instancePath(cwd, root)); // dead 或 cwd 不符=stale
    // unknown:不删,落到扫描(还会再探一次,仍 unknown 则跳过)
  }

  const alive: { port: number; cwd: string }[] = [];
  for (const e of listInstances(root)) {
    const p = await probeBus(e.info.port, fetchFn, timeoutMs ?? 500);
    if (p.state === 'alive' && p.info.cwd === e.info.cwd) alive.push({ port: e.info.port, cwd: e.info.cwd });
    else if (p.state === 'dead' || p.state === 'alive') removeInstanceFile(e.file);
  }
  if (alive.length === 1) return { ok: true, port: alive[0].port };
  if (alive.length === 0) return { ok: false, error: t().busNotFound };
  return {
    ok: false,
    error: t().busMultiple(alive.length, alive.map((a) => t().busInstanceLine(a.cwd, a.port)).join('\n')),
  };
}
