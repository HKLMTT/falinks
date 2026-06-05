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
  const fNoCwd = (async () => new Response(JSON.stringify({ hello: 1 }), { status: 200 })) as typeof fetch;
  expect((await probeBus(1, fNoCwd)).state).toBe('dead');
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

// I-1: 200 + 非 JSON body = 不是 falinks → dead(stale 档案应自愈清理)
test('probeBus:200 + 非 JSON body → dead', async () => {
  const fHtml = (async () => new Response('<html>not json</html>', { status: 200 })) as typeof fetch;
  expect((await probeBus(1, fHtml)).state).toBe('dead');
});

// I-2: alive 分支缺 pid 字段 → dead
test('probeBus:alive 分支缺 pid → dead', async () => {
  const fNoPid = (async () =>
    new Response(JSON.stringify({ cwd: '/a' }), { status: 200 })) as typeof fetch;
  expect((await probeBus(1, fNoPid)).state).toBe('dead');
});

// M-1: 本项目档案首次 unknown、扫描阶段第二次探活恢复 alive → 命中且档案保留
test('resolveBus:本项目首次 unknown、扫描期恢复 alive → 命中', async () => {
  const root = tmpRoot(); const cwd = tmpCwd();
  writeInstance({ port: 50003, pid: 1, cwd, startedAt: 1 }, root);
  let call = 0;
  const fetchFn = (async () => {
    call++;
    if (call === 1) { const e: any = new Error('aborted'); e.name = 'AbortError'; throw e; }
    return new Response(JSON.stringify({ cwd, pid: 1, startedAt: 1 }), { status: 200 });
  }) as typeof fetch;
  const r = await resolveBus(cwd, { root, fetchFn });
  expect(r).toEqual({ ok: true, port: 50003 });
  expect(readInstance(cwd, root)).not.toBeNull();
});

// M-2: AggregateError 形态的 ECONNREFUSED(Node 24 undici 实际形态)→ dead
test('probeBus:ECONNREFUSED 以 AggregateError 形式包装 → dead', async () => {
  const fAgg = (async () => {
    const e: any = new TypeError('fetch failed');
    e.cause = new AggregateError([Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })]);
    throw e;
  }) as typeof fetch;
  expect((await probeBus(1, fAgg)).state).toBe('dead');
});
