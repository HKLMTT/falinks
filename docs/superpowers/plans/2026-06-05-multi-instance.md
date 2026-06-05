# 多实例并发实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 多个 falinks 办公室可同时运行:端口自动分配,每项目 runtime 发现文件 + 身份核对,CLI 子命令按 cwd 寻址。

**Architecture:** `busPort` 改可选、缺省 `listen(0)`;`~/.falinks/runtime.json` 全局单文件改为 `~/.falinks/runtime/<sha1(realpath(cwd))前16>.json` 每项目一份(与 sessions/messages 同 hash 模式);总线加 `GET /admin/info` 身份端点,所有按文件找端口的路径必须探活并核对 cwd(防端口复用劫持);探活三态(活/确死/不明),不明时保守拒绝。回退控制台直接传 `--port` 不走发现。

**Tech Stack:** TypeScript + Node 20(原生 fetch/AbortController)、vitest。无新依赖。

**规格:** `docs/superpowers/specs/2026-06-05-multi-instance-design.md`

---

### Task 1: config.busPort 改可选

**Files:**
- Modify: `src/core/config.ts`
- Test: `tests/core/config.test.ts`

- [ ] **Step 1: 加失败测试**

在 `tests/core/config.test.ts` 末尾追加:

```ts
test('busPort 可省略(多实例:缺省自动分配)', () => {
  const cfg = parseConfig({ agents: [{ name: 'a', cli: 'claude', cwd: '/x', bootstrap: 'b' }] });
  expect(cfg.busPort).toBeUndefined();
});

test('busPort 给了但不是数字仍报错', () => {
  expect(() => parseConfig({ busPort: 'x', agents: [{ name: 'a', cli: 'claude', cwd: '/x', bootstrap: 'b' }] })).toThrow(/busPort/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/config.test.ts`
Expected: 第一条 FAIL(`config.busPort must be a number`)。

- [ ] **Step 3: 最小实现**

`src/core/config.ts`:

```ts
export interface FalinksConfig {
  busPort?: number; // 缺省 = 启动时自动分配(listen 0)
  agents: AgentConfig[];
  routes: Record<string, AgentName>;
  guards: GuardConfig;
}
```

校验行改为:

```ts
  if (raw.busPort !== undefined && typeof raw.busPort !== 'number')
    throw new Error('config.busPort must be a number');
```

(返回值 `busPort: raw.busPort` 不用动,undefined 自然透传。)

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/config.test.ts`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/core/config.test.ts
git commit -m "feat(config): busPort 改可选,缺省由系统自动分配端口"
```

---

### Task 2: runtime.ts — projectKey + 每项目 instance 文件

**Files:**
- Modify: `src/runtime.ts`
- Test: `tests/runtime.test.ts`

- [ ] **Step 1: 加失败测试**

`tests/runtime.test.ts` 追加(保留现有 3 条用例;`runtimePath` 仍存在,供一次性迁移删除用):

```ts
import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  projectKey, instancePath, writeInstance, readInstance,
  removeInstanceIfOwner, listInstances, type InstanceInfo,
} from '../src/runtime.js';

const tmpRoot = () => mkdtempSync(join(tmpdir(), 'falinks-rt-'));

test('projectKey 对符号链接和真实路径给出同一个 key', () => {
  const real = realpathSync(mkdtempSync(join(tmpdir(), 'falinks-real-')));
  const link = join(mkdtempSync(join(tmpdir(), 'falinks-lnk-')), 'lnk');
  symlinkSync(real, link);
  expect(projectKey(link)).toBe(projectKey(real));
  expect(projectKey(real)).toMatch(/^[0-9a-f]{16}$/);
});

test('instance 文件写读删,按 cwd 寻址', () => {
  const root = tmpRoot();
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'falinks-p-')));
  const info: InstanceInfo = { port: 50001, pid: process.pid, cwd, startedAt: 1 };
  expect(writeInstance(info, root)).toBe(true);
  expect(readInstance(cwd, root)).toEqual(info);
  expect(instancePath(cwd, root).startsWith(join(root, 'runtime'))).toBe(true);
  removeInstanceIfOwner(cwd, process.pid, root);
  expect(readInstance(cwd, root)).toBeNull();
});

test('writeInstance 排他:已存在返回 false 不覆盖;force 才覆盖', () => {
  const root = tmpRoot();
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'falinks-p-')));
  const a: InstanceInfo = { port: 1, pid: 1, cwd, startedAt: 1 };
  const b: InstanceInfo = { port: 2, pid: 2, cwd, startedAt: 2 };
  expect(writeInstance(a, root)).toBe(true);
  expect(writeInstance(b, root)).toBe(false);
  expect(readInstance(cwd, root)!.port).toBe(1);
  expect(writeInstance(b, root, { force: true })).toBe(true);
  expect(readInstance(cwd, root)!.port).toBe(2);
});

test('removeInstanceIfOwner:pid 不匹配不删(防误删他人实例)', () => {
  const root = tmpRoot();
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'falinks-p-')));
  writeInstance({ port: 1, pid: 99999999, cwd, startedAt: 1 }, root);
  removeInstanceIfOwner(cwd, 1, root);
  expect(readInstance(cwd, root)).not.toBeNull();
});

test('listInstances 列出全部(损坏的跳过)', () => {
  const root = tmpRoot();
  const c1 = realpathSync(mkdtempSync(join(tmpdir(), 'falinks-p1-')));
  const c2 = realpathSync(mkdtempSync(join(tmpdir(), 'falinks-p2-')));
  writeInstance({ port: 1, pid: 1, cwd: c1, startedAt: 1 }, root);
  writeInstance({ port: 2, pid: 2, cwd: c2, startedAt: 2 }, root);
  require('node:fs').writeFileSync(join(root, 'runtime', 'broken.json'), '{oops');
  const all = listInstances(root);
  expect(all.map((e) => e.info.port).sort()).toEqual([1, 2]);
  expect(all[0].file.endsWith('.json')).toBe(true);
});
```

注意:测试文件是 ESM,最后一条的 `require` 改为顶部 `import { writeFileSync } from 'node:fs'` 后直接调用。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/runtime.test.ts`
Expected: FAIL(`projectKey` 等导出不存在)。

- [ ] **Step 3: 实现**

`src/runtime.ts` 追加:

```ts
import { createHash } from 'node:crypto';
import { realpathSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs';

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
```

同文件 `consoleLaunchCommand` 加可选 port(回退控制台直传端口,不走发现):

```ts
export function consoleLaunchCommand(selfScript: string, execPath: string, port?: number): string {
  const suffix = port ? ` --port ${port}` : '';
  return selfScript.endsWith('.ts')
    ? `npx tsx ${selfScript} console${suffix}`
    : `${execPath} ${selfScript} console${suffix}`;
}
```

并给 `tests/runtime.test.ts` 加:

```ts
test('consoleLaunchCommand 带 port 时追加 --port', () => {
  expect(consoleLaunchCommand('/d/cli.js', '/usr/bin/node', 50123)).toBe('/usr/bin/node /d/cli.js console --port 50123');
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/runtime.test.ts`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/runtime.ts tests/runtime.test.ts
git commit -m "feat(runtime): 每项目 instance 档案(projectKey/wx 排他/owner 删除) + console --port"
```

---

### Task 3: 总线 /admin/info + 端口占用自动回退

**Files:**
- Modify: `src/bus/server.ts`
- Test: `tests/bus/info.test.ts`(新建)

- [ ] **Step 1: 加失败测试**

新建 `tests/bus/info.test.ts`(套用 `tests/bus/admin.test.ts` 的起 bus 模式):

```ts
import { afterEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { Guards } from '../../src/core/guards.js';
import { startBus, type Bus } from '../../src/bus/server.js';

const mkRouter = () =>
  new Router({ deliver: () => {} }, { now: () => 1, genId: () => 'm1', routes: {}, guards: new Guards(undefined, () => 1) });

let buses: Bus[] = [];
afterEach(async () => { for (const b of buses) await b.close(); buses = []; });

async function start(port: number, opts?: Parameters<typeof startBus>[2]) {
  const b = await startBus({ router: mkRouter(), getSessionId: () => undefined }, port, opts);
  buses.push(b);
  return b;
}

test('GET /admin/info 返回身份(cwd/pid/startedAt)', async () => {
  const b = await start(0, { identity: { cwd: '/proj/a', startedAt: 42 } });
  const info = await (await fetch(`http://127.0.0.1:${b.port}/admin/info`)).json();
  expect(info).toEqual({ cwd: '/proj/a', pid: process.pid, startedAt: 42 });
});

test('未传 identity 也有兜底身份', async () => {
  const b = await start(0);
  const info = await (await fetch(`http://127.0.0.1:${b.port}/admin/info`)).json();
  expect(info.pid).toBe(process.pid);
  expect(typeof info.cwd).toBe('string');
});

test('显式端口被占用 → 自动回退系统分配并回调告警,不再 exit', async () => {
  const first = await start(0);
  let fallback: { wanted: number; got: number } | null = null;
  const second = await start(first.port, { onPortFallback: (wanted, got) => { fallback = { wanted, got }; } });
  expect(second.port).not.toBe(first.port);
  expect(fallback).toEqual({ wanted: first.port, got: second.port });
});
```

注:`Router` 构造参数以 `tests/bus/admin.test.ts` 现状为准——抄它的 router 构造写法,别用上面的猜测版。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/bus/info.test.ts`
Expected: FAIL(/admin/info 404;第三条直接 process.exit 导致测试崩——这正是要除掉的行为)。

- [ ] **Step 3: 实现**

`src/bus/server.ts`:

新增选项类型,`startBus` 签名扩展(保持第二参兼容):

```ts
export interface BusOptions {
  /** 实例身份,/admin/info 返回它(寻址方核对 cwd 用)。 */
  identity?: { cwd: string; startedAt: number };
  /** 显式端口被占用、回退系统分配后回调(告警呈现交给调用方)。 */
  onPortFallback?(wanted: number, got: number): void;
}

export async function startBus(deps: BusDeps, port: number, opts?: BusOptions): Promise<Bus> {
```

函数体开头:

```ts
  const identity = {
    cwd: opts?.identity?.cwd ?? process.cwd(),
    pid: process.pid,
    startedAt: opts?.identity?.startedAt ?? Date.now(),
  };
```

admin 路由区(`/admin/roster` 旁)加:

```ts
      if (req.method === 'GET' && url.pathname === '/admin/info') {
        return sendJson(identity);
      }
```

末尾的 listen Promise 整体替换(删掉 `process.exit(1)` 那段):

```ts
  return new Promise((resolve, reject) => {
    const tryListen = (p: number, isRetry: boolean) => {
      httpServer.once('error', (e: NodeJS.ErrnoException) => {
        // 显式端口被占用:回退系统分配重试一次(多实例并发的常态,不是错误)。
        if (e.code === 'EADDRINUSE' && !isRetry) { tryListen(0, true); return; }
        reject(e);
      });
      httpServer.listen(p, '127.0.0.1', () => {
        const addr = httpServer.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : p;
        if (isRetry) opts?.onPortFallback?.(port, actualPort);
        resolve({
          port: actualPort,
          close: () => new Promise<void>((r) => httpServer.close(() => r())),
        });
      });
    };
    tryListen(port, false);
  });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/bus/`
Expected: info.test.ts 全 PASS,其余 bus 测试不受影响。

- [ ] **Step 5: Commit**

```bash
git add src/bus/server.ts tests/bus/info.test.ts
git commit -m "feat(bus): /admin/info 身份端点 + 端口占用自动回退(去掉 process.exit)"
```

---

### Task 4: discovery 模块 — 三态探活 + 按 cwd 寻址

**Files:**
- Create: `src/discovery.ts`
- Test: `tests/discovery.test.ts`(新建)

- [ ] **Step 1: 加失败测试**

新建 `tests/discovery.test.ts`:

```ts
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { writeInstance, readInstance } from '../src/runtime.js';
import { probeBus, resolveBus } from '../src/discovery.js';

const tmpRoot = () => mkdtempSync(join(tmpdir(), 'falinks-disc-'));
const tmpCwd = () => realpathSync(mkdtempSync(join(tmpdir(), 'falinks-cwd-')));

/** fetch stub:按端口返回 alive(info)/dead/unknown。 */
function fetchStub(map: Record<number, { cwd: string } | 'dead' | 'unknown'>): typeof fetch {
  return (async (input: any) => {
    const port = Number(new URL(String(input)).port);
    const v = map[port];
    if (v === 'dead' || v === undefined) {
      const e: any = new TypeError('fetch failed');
      e.cause = { code: 'ECONNREFUSED' };
      throw e;
    }
    if (v === 'unknown') { const e: any = new Error('aborted'); e.name = 'AbortError'; throw e; }
    return new Response(JSON.stringify({ cwd: v.cwd, pid: 1, startedAt: 1 }), { status: 200 });
  }) as typeof fetch;
}

test('probeBus 三态:alive / dead(ECONNREFUSED) / unknown(超时等)', async () => {
  expect((await probeBus(1, fetchStub({ 1: { cwd: '/a' } }))).state).toBe('alive');
  expect((await probeBus(2, fetchStub({ 2: 'dead' }))).state).toBe('dead');
  expect((await probeBus(3, fetchStub({ 3: 'unknown' }))).state).toBe('unknown');
});

test('probeBus:非 falinks 服务(非 200 或无 cwd)算 dead', async () => {
  const f404 = (async () => new Response('nope', { status: 404 })) as typeof fetch;
  expect((await probeBus(1, f404)).state).toBe('dead');
});

test('resolveBus:本项目档案活着且 cwd 一致 → 命中', async () => {
  const root = tmpRoot(); const cwd = tmpCwd();
  writeInstance({ port: 50001, pid: 1, cwd, startedAt: 1 }, root);
  const r = await resolveBus(cwd, { root, fetchFn: fetchStub({ 50001: { cwd } }) });
  expect(r).toEqual({ ok: true, port: 50001 });
});

test('resolveBus:cwd 不一致(端口被别的项目复用)→ 删 stale,不命中', async () => {
  const root = tmpRoot(); const cwd = tmpCwd();
  writeInstance({ port: 50001, pid: 1, cwd, startedAt: 1 }, root);
  const r = await resolveBus(cwd, { root, fetchFn: fetchStub({ 50001: { cwd: '/别的项目' } }) });
  expect(r.ok).toBe(false);
  expect(readInstance(cwd, root)).toBeNull(); // stale 已自愈清掉
});

test('resolveBus:本目录没有,全局恰好一个活实例 → 借用它', async () => {
  const root = tmpRoot(); const other = tmpCwd();
  writeInstance({ port: 50002, pid: 1, cwd: other, startedAt: 1 }, root);
  const r = await resolveBus(tmpCwd(), { root, fetchFn: fetchStub({ 50002: { cwd: other } }) });
  expect(r).toEqual({ ok: true, port: 50002 });
});

test('resolveBus:多个活实例 → 报错列出各自 cwd', async () => {
  const root = tmpRoot(); const c1 = tmpCwd(); const c2 = tmpCwd();
  writeInstance({ port: 1, pid: 1, cwd: c1, startedAt: 1 }, root);
  writeInstance({ port: 2, pid: 1, cwd: c2, startedAt: 1 }, root);
  const r = await resolveBus(tmpCwd(), { root, fetchFn: fetchStub({ 1: { cwd: c1 }, 2: { cwd: c2 } }) });
  expect(r.ok).toBe(false);
  if (!r.ok) { expect(r.error).toContain(c1); expect(r.error).toContain(c2); }
});

test('resolveBus:全死 → 报"找不到",且 stale 档案被清', async () => {
  const root = tmpRoot(); const c1 = tmpCwd();
  writeInstance({ port: 1, pid: 1, cwd: c1, startedAt: 1 }, root);
  const r = await resolveBus(tmpCwd(), { root, fetchFn: fetchStub({ 1: 'dead' }) });
  expect(r.ok).toBe(false);
  expect(readInstance(c1, root)).toBeNull();
});

test('resolveBus:unknown 的不删档案也不当活的', async () => {
  const root = tmpRoot(); const c1 = tmpCwd();
  writeInstance({ port: 1, pid: 1, cwd: c1, startedAt: 1 }, root);
  const r = await resolveBus(tmpCwd(), { root, fetchFn: fetchStub({ 1: 'unknown' }) });
  expect(r.ok).toBe(false);
  expect(readInstance(c1, root)).not.toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/discovery.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

新建 `src/discovery.ts`:

```ts
import { runtimeDir, realCwd, readInstance, removeInstanceFile, instancePath, listInstances } from './runtime.js';

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
    const info = await res.json();
    if (typeof info?.cwd !== 'string') return { state: 'dead' };
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
  opts?: { root?: string; fetchFn?: typeof fetch },
): Promise<Resolved> {
  const root = opts?.root ?? runtimeDir();
  const fetchFn = opts?.fetchFn ?? fetch;
  const me = realCwd(cwd);

  const mine = readInstance(cwd, root);
  if (mine) {
    const p = await probeBus(mine.port, fetchFn);
    if (p.state === 'alive' && p.info.cwd === me) return { ok: true, port: mine.port };
    if (p.state === 'dead' || p.state === 'alive') removeInstanceFile(instancePath(cwd, root)); // dead 或 cwd 不符=stale
    // unknown:不删,落到扫描(还会再探一次,仍 unknown 则跳过)
  }

  const alive: { port: number; cwd: string }[] = [];
  for (const e of listInstances(root)) {
    const p = await probeBus(e.info.port, fetchFn);
    if (p.state === 'alive' && p.info.cwd === e.info.cwd) alive.push({ port: e.info.port, cwd: e.info.cwd });
    else if (p.state === 'dead' || p.state === 'alive') removeInstanceFile(e.file);
  }
  if (alive.length === 1) return { ok: true, port: alive[0].port };
  if (alive.length === 0) return { ok: false, error: '找不到运行中的 falinks —— `falinks` 在运行吗？' };
  return {
    ok: false,
    error:
      `有 ${alive.length} 个 falinks 在运行，请到对应目录执行：\n` +
      alive.map((a) => `  ${a.cwd}（端口 ${a.port}）`).join('\n'),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/discovery.test.ts tests/runtime.test.ts`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/discovery.ts tests/discovery.test.ts
git commit -m "feat(discovery): 三态探活 + 按 cwd 寻址(身份核对/stale 自愈/唯一活实例回退)"
```

---

### Task 5: index.ts 集成 — 防双开/写档案/退出清理/告警传递

**Files:**
- Modify: `src/index.ts`(import 区、`startBus` 调用处 `:150-206`、控制台启动段 `:208-226`、`:274-276`)
- Modify: `src/console/run.tsx`、`src/console/app.tsx`(initialStatus 透传)

集成层是薄胶水,单测靠 Task 2/4 的单元覆盖,这里以编译+全量回归+Task 8 真机冒烟验收。

- [ ] **Step 1: index.ts 改造**

import 区:

```ts
import { runtimeDir, runtimePath, consoleLaunchCommand, writeInstance, readInstance, removeInstanceIfOwner, removeInstanceFile, instancePath } from './runtime.js';
import { probeBus } from './discovery.js';
import { rmSync } from 'node:fs'; // 并入现有 node:fs import
```

`up()` 开头、`launchCwd` 计算之后加防双开(launchCwd 已 realpath,与档案 cwd 同构):

```ts
  // 防双开:同目录的 sessions/messages 是共享的,双开必然互相污染。
  const existing = readInstance(launchCwd);
  if (existing) {
    const p = await probeBus(existing.port);
    if (p.state === 'alive' && p.info.cwd === launchCwd) {
      console.error(`该目录已有 falinks 在运行（端口 ${existing.port}）。先在那边 Ctrl-C 收工，再启动。`);
      process.exit(1);
    }
    if (p.state === 'unknown') {
      console.error(`疑似有 falinks 在运行（端口 ${existing.port}）但探活超时。确认没在运行后删除：${instancePath(launchCwd)}`);
      process.exit(1);
    }
    removeInstanceFile(instancePath(launchCwd)); // 确认死了/张冠李戴:清掉尸体
  }
```

`startBus` 调用(`:204`)改为:

```ts
  let portWarning = ''; // 显式端口被占回退时的提示;控制台模式 stderr 会被清屏吞掉,改走首条 status
  bus = await startBus({
    /* …deps 原样… */
  }, cfg.busPort ?? 0, {
    identity: { cwd: launchCwd, startedAt: Date.now() },
    onPortFallback: (wanted, got) => { portWarning = `⚠ 端口 ${wanted} 被占用，已自动改用 ${got}`; },
  });
```

`runtime.json` 写入两行(`:205-206`)替换为:

```ts
  mkdirSync(runtimeDir(), { recursive: true });
  rmSync(runtimePath(), { force: true }); // 旧版全局 runtime.json:一次性迁移清理
  const inst = { port: bus.port, pid: process.pid, cwd: launchCwd, startedAt: Date.now() };
  if (!writeInstance(inst)) {
    // wx 失败=毫秒级竞态里别人先写了:再探一次,活着就让位,死的覆盖。
    const race = readInstance(launchCwd);
    const p = race ? await probeBus(race.port) : null;
    if (p?.state === 'alive' && p.info.cwd === launchCwd) {
      console.error(`该目录已有 falinks 在运行（端口 ${race!.port}）。`);
      process.exit(1);
    }
    writeInstance(inst, undefined, { force: true });
  }
  const cleanupInstance = () => removeInstanceIfOwner(launchCwd, process.pid);
  process.on('exit', cleanupInstance);
  process.on('SIGTERM', () => process.exit(0)); // 默认 SIGTERM 不走 exit 钩子,显式转一下
  process.on('SIGINT', () => process.exit(0));  // 非控制台模式 Ctrl-C(控制台模式 raw mode 自行处理)
```

回退控制台命令(`:223`):

```ts
    const consoleCmd = consoleLaunchCommand(process.argv[1], process.execPath, bus.port);
```

非控制台模式把告警打出来(`:222` 的 `console.log` 后):

```ts
    if (portWarning) console.error(`[falinks] ${portWarning}`);
```

末行(`:275`):

```ts
  if (inProcessConsole) renderConsole(bus.port, portWarning || undefined);
```

- [ ] **Step 2: 控制台 initialStatus 透传**

`src/console/run.tsx`:

```ts
export function renderConsole(port: number, initialStatus?: string): void {
  // …原样…
  render(<App port={port} initialStatus={initialStatus} />, { exitOnCtrlC: false });
}
```

`src/console/app.tsx`:

```tsx
export function App({ port, initialStatus }: { port: number; initialStatus?: string }) {
  // …
  const [status, setStatus] = useState(initialStatus ?? '');
```

- [ ] **Step 3: 编译 + 全量回归**

Run: `npm run build && npm test`
Expected: 编译零错,182+ 全 PASS。

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/console/run.tsx src/console/app.tsx
git commit -m "feat(up): 防双开守卫 + 实例档案写入/退出清理 + 端口回退告警透传控制台"
```

---

### Task 6: CLI 子命令与回退控制台寻址

**Files:**
- Modify: `src/cli.ts`(`runtimePort`/`admin`,`:16-32`)
- Modify: `src/console/main.tsx`

- [ ] **Step 1: cli.ts 改造**

删掉 `runtimePort()` 和 `runtimePath` import,`admin()` 改为:

```ts
import { resolveBus } from './discovery.js';

let cachedPort: number | null = null;
async function busPort(): Promise<number> {
  if (cachedPort) return cachedPort;
  const r = await resolveBus(process.cwd());
  if (!r.ok) { console.error(r.error); process.exit(1); }
  return (cachedPort = r.port);
}

async function admin(method: string, path: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${await busPort()}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}
```

- [ ] **Step 2: console/main.tsx 改造**

```ts
import { renderConsole } from './run.js';
import { resolveBus } from '../discovery.js';

// 优先 --port(up 直传,免发现);手动调用回退按 cwd 寻址。
const i = process.argv.indexOf('--port');
const argPort = i >= 0 ? Number(process.argv[i + 1]) : NaN;
if (Number.isFinite(argPort) && argPort > 0) {
  renderConsole(argPort);
} else {
  const r = await resolveBus(process.cwd());
  if (!r.ok) { console.error(r.error); process.exit(1); }
  renderConsole(r.port);
}
```

(原 `runtimePort()` 与 `runtimePath` import 删除。)

- [ ] **Step 3: 编译 + 全量回归**

Run: `npm run build && npm test`
Expected: 全 PASS。

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts src/console/main.tsx
git commit -m "feat(cli): say/roster/log 等按 cwd 寻址(resolveBus);console 子命令支持 --port"
```

---

### Task 7: 新配置不再写 busPort

**Files:**
- Modify: `src/templates.ts:56-62`、`src/cli.ts`(`writeDefaultConfig`)
- Test: `tests/templates.test.ts:27`

- [ ] **Step 1: 改测试(先红)**

`tests/templates.test.ts:27` 改为:

```ts
  expect('busPort' in cfg).toBe(false);
```

Run: `npx vitest run tests/templates.test.ts`
Expected: 该条 FAIL(现在还写 7878)。

- [ ] **Step 2: 实现**

`src/templates.ts`:

```ts
/** 由一组成员生成 falinks 配置(所有员工工作目录=cwd)。busPort 不写:缺省自动分配,多实例不冲突。 */
export function configFromMembers(members: TeamMember[], cwd: string) {
  return {
    agents: members.map((m) => ({ name: m.name, cli: m.cli, cwd, role: m.role, bootstrap: bootstrapForRole(m.role) })),
    routes: {},
  };
}
```

(确认调用方没人传第三参:`grep -rn "configFromMembers(" src/ tests/`,有则删参。)

`src/cli.ts` `writeDefaultConfig` 里删掉 `busPort: 7878,` 一行。

- [ ] **Step 3: 跑测试确认通过**

Run: `npm test`
Expected: 全 PASS(team-persist 测试夹具里的 busPort: 7878 仍合法——可选字段)。

- [ ] **Step 4: Commit**

```bash
git add src/templates.ts src/cli.ts tests/templates.test.ts
git commit -m "feat: 新生成的配置/模板不再写 busPort(缺省自动分配)"
```

---

### Task 8: 文档 + 真机冒烟

**Files:**
- Modify: `README.md`、`CHANGELOG.md`

- [ ] **Step 1: CHANGELOG 加条目**(放最上面,版本号沿用仓库惯例,如 0.2.7 未发布段):

```markdown
## 0.2.7(未发布)

- **多实例并发**:端口改为自动分配(busPort 可选;显式端口被占自动回退并提示),
  `~/.falinks/runtime.json` 改为每项目 `runtime/<hash>.json`,`falinks say/roster/log`
  按当前目录寻址(全局唯一实例时任意目录可用)。同目录防双开。崩溃残留档案探活自愈。
```

- [ ] **Step 2: README**:找到提及"同一时间一个/busPort"的段落更新;在 FAQ 或特性区补一句"多项目可同时各开一间办公室"。

- [ ] **Step 3: 真机冒烟**(需要 iTerm2,人工或 AppleScript):

1. 目录 A:`falinks up` → 正常起,`cat ~/.falinks/runtime/*.json` 见 A 的档案。
2. 目录 B:`falinks up` → 第二间办公室正常起(端口不同)。
3. 目录 A 再开一个 `falinks up` → 拒绝:"该目录已有 falinks 在运行"。
4. 目录 A `falinks roster` → 返回 A 的花名册;目录 B `falinks roster` → B 的。
5. 无关目录 C `falinks roster`(两实例都活着)→ 报错列出 A、B 的 cwd。
6. 关掉 B,目录 C `falinks roster` → 借用 A(唯一活实例)。
7. `kill -9` A 的 up 进程 → 档案残留;目录 A `falinks roster` → "找不到"且档案被自愈清掉。
8. 旧 `~/.falinks/runtime.json` 在一次启动后消失。

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: 多实例并发说明(0.2.7)"
```

---

## Self-Review 结果

- **规格覆盖**:设计 §1→Task 1/3/7,§2→Task 2/5,§3→Task 3/4,§4→Task 4,§5→Task 5,§6→Task 5/6,错误处理→Task 2(损坏容错)/4(三态),测试→各 task,文档→Task 8。无缺口。
- **占位符**:无 TBD/“适当处理”;Task 3 对 Router 构造显式标注“以现有测试为准”,属防漂移指引而非占位。
- **类型一致性**:`InstanceInfo`/`writeInstance(info, root, {force})`/`removeInstanceIfOwner(cwd, pid, root)`/`probeBus(port, fetchFn, timeoutMs)`/`resolveBus(cwd, {root, fetchFn})`/`startBus(deps, port, opts)` 在 Task 2/3/4/5/6 间已核对一致。
