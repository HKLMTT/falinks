import { afterEach, beforeEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, QuestionStore, type Bus } from '../../src/bus/server.js';

test('QuestionStore: add 生成唯一 id、list、take 取出即删', () => {
  const qs = new QuestionStore();
  const id1 = qs.add({ from: 'a', question: 'q1', options: ['x', 'y'] });
  const id2 = qs.add({ from: 'b', question: 'q2', options: ['z'] });
  expect(id1).not.toBe(id2);
  expect(qs.list().map((q) => q.id).sort()).toEqual([id1, id2].sort());
  const taken = qs.take(id1);
  expect(taken?.from).toBe('a');
  expect(qs.take(id1)).toBeUndefined(); // 取过即删
  expect(qs.list().length).toBe(1);
});

let bus: Bus; let driver: FakeDriver; let router: Router;
const sessions = new Map<string, string>();

async function callTool(agent: string, name: string, args: Record<string, unknown> = {}) {
  const url = new URL(`http://127.0.0.1:${bus.port}/agent/${agent}/mcp`);
  const client = new Client({ name: `c-${agent}`, version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(url));
  const res: any = await client.callTool({ name, arguments: args });
  await client.close();
  return JSON.parse(res.content[0].text);
}
async function http(method: string, path: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${bus.port}${path}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

beforeEach(async () => {
  driver = new FakeDriver();
  let n = 0;
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}`, routes: {} });
  router.addAgent('alice'); router.addAgent('bob'); router.addVirtual('boss');
  sessions.set('alice', await driver.launch({ cwd: '/a', command: 'cat' }));
  sessions.set('bob', await driver.launch({ cwd: '/b', command: 'cat' }));
  router.register('alice', sessions.get('alice')!);
  router.register('bob', sessions.get('bob')!);
  bus = await startBus({ router, getSessionId: (nm) => sessions.get(nm) }, 0);
});
afterEach(async () => { await bus.close(); });

test('ask to boss -> pending,/admin/questions 能查到', async () => {
  const r = await callTool('alice', 'ask', { to: 'boss', question: '用哪个方案?', options: ['A', 'B', 'C'] });
  expect(r.ok).toBe(true);
  expect(r.pending).toBe(true);
  const { questions } = await http('GET', '/admin/questions');
  expect(questions.length).toBe(1);
  expect(questions[0]).toMatchObject({ from: 'alice', question: '用哪个方案?', options: ['A', 'B', 'C'] });
});

test('ask to agent -> 投递带编号选项的消息(不进 pending)', async () => {
  const r = await callTool('alice', 'ask', { to: 'bob', question: '选哪个?', options: ['甲', '乙'] });
  expect(r.ok).toBe(true);
  const inj = driver.injections.find((i) => i.sessionId === sessions.get('bob') && i.text.includes('选哪个?'));
  expect(inj).toBeTruthy();
  expect(inj!.text).toContain('1. 甲');
  expect(inj!.text).toContain('2. 乙');
  const { questions } = await http('GET', '/admin/questions');
  expect(questions.length).toBe(0);
});

test('/admin/answer 正常下标 -> 注回提问者且 pending 清空', async () => {
  await callTool('alice', 'ask', { to: 'boss', question: '用哪个方案?', options: ['A', 'B', 'C'] });
  const { questions } = await http('GET', '/admin/questions');
  const id = questions[0].id;
  const r = await http('POST', '/admin/answer', { id, choice: 1 });
  expect(r.ok).toBe(true);
  expect(driver.injections.some((i) => i.sessionId === sessions.get('alice') && i.text.includes('B'))).toBe(true);
  expect((await http('GET', '/admin/questions')).questions.length).toBe(0);
});

test('/admin/answer 越界 / 未知 id -> 友好错误', async () => {
  await callTool('alice', 'ask', { to: 'boss', question: 'q', options: ['A'] });
  const { questions } = await http('GET', '/admin/questions');
  expect((await http('POST', '/admin/answer', { id: questions[0].id, choice: 9 })).error).toBe('bad choice');
  expect((await http('POST', '/admin/answer', { id: 'nope', choice: 0 })).error).toBe('no such question');
});

test('/admin/answer 自定义 text -> 把老板自由回答注回提问者,pending 清空', async () => {
  await callTool('alice', 'ask', { to: 'boss', question: '用哪个方案?', options: ['A', 'B'] });
  const { questions } = await http('GET', '/admin/questions');
  const r = await http('POST', '/admin/answer', { id: questions[0].id, text: '都不用,先调研一周' });
  expect(r.ok).toBe(true);
  expect(driver.injections.some((i) => i.sessionId === sessions.get('alice') && i.text.includes('都不用,先调研一周'))).toBe(true);
  expect((await http('GET', '/admin/questions')).questions.length).toBe(0);
});

// —— todo 模式无人值守:running 时禁 ask→boss ——

const TODO_DEPS = (state: string) => ({
  taskdone: () => ({ ok: true }),
  taskwait: () => ({ ok: true }),
  op: () => ({ ok: true }),
  state: () => ({ state, nudgeMinutes: 10, tasks: [] }),
  plan: () => ({ ok: true, seqs: [] }),
  leadstate: () => ({ ok: true }),
});

test('todo running 时 ask→boss 被拒、不进 pending,提示自行按最优方案推进', async () => {
  await bus.close();
  bus = await startBus({ router, getSessionId: (nm) => sessions.get(nm), todo: TODO_DEPS('running') }, 0);
  const r = await callTool('alice', 'ask', { to: 'boss', question: '用哪个方案?', options: ['A', 'B'] });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/无人值守|unattended/i);
  expect((await http('GET', '/admin/questions')).questions.length).toBe(0); // 没落到 pending
});

test('todo running 时问同事的 ask 照常(不卡人)', async () => {
  await bus.close();
  bus = await startBus({ router, getSessionId: (nm) => sessions.get(nm), todo: TODO_DEPS('running') }, 0);
  const r = await callTool('alice', 'ask', { to: 'bob', question: '选哪个?', options: ['甲', '乙'] });
  expect(r.ok).toBe(true);
  expect(driver.injections.some((i) => i.sessionId === sessions.get('bob') && i.text.includes('选哪个?'))).toBe(true);
});

test('todo 非 running(idle)时 ask→boss 照常进 pending(不误伤启动前审批)', async () => {
  await bus.close();
  bus = await startBus({ router, getSessionId: (nm) => sessions.get(nm), todo: TODO_DEPS('idle') }, 0);
  const r = await callTool('alice', 'ask', { to: 'boss', question: '可以 todostart 吗?', options: ['同意', '再改改'] });
  expect(r.ok).toBe(true);
  expect(r.pending).toBe(true);
  expect((await http('GET', '/admin/questions')).questions.length).toBe(1);
});
