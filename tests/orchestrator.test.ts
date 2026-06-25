import { expect, test } from 'vitest';
import { formatMessage, formatBatch, makeDeliverer } from '../src/orchestrator.js';
import { FakeDriver } from '../src/terminal/driver.js';
import { setLocale } from '../src/i18n/index.js';
import type { AgentRuntime, Message } from '../src/core/types.js';

test('formatMessage embeds sender, body, and reply convention', () => {
  const msg: Message = { id: 'm1', from: 'alice', to: 'bob', body: '帮我看下登录', ts: 1 };
  const text = formatMessage(msg);
  expect(text).toContain('alice');
  expect(text).toContain('帮我看下登录');
  expect(text).toContain('sendmsg');
  expect(text).toContain('"alice"');
});

test('formatBatch:单条 == formatMessage(逐字不变、无包装)', () => {
  const msg: Message = { id: 'm1', from: 'alice', to: 'bob', body: 'hi', ts: 1 };
  expect(formatBatch([msg])).toBe(formatMessage(msg));
});

test('formatBatch:≥2 条带合并头 + 编号 + from 归属', () => {
  const msgs: Message[] = [
    { id: 'm1', from: 'alice', to: 'bob', body: 'AAA', ts: 1 },
    { id: 'm2', from: 'carol', to: 'bob', body: 'BBB', ts: 2 },
  ];
  const text = formatBatch(msgs);
  expect(text).toContain('[1]');
  expect(text).toContain('[2]');
  expect(text).toContain('alice');  // from 归属
  expect(text).toContain('carol');
  expect(text).toContain('AAA');
  expect(text).toContain('BBB');
  expect(text).toContain('2');       // 合并头含条数
});

test('deliverer injects formatted text (submit=true) into the agent sessionId', async () => {
  const driver = new FakeDriver();
  const sid = await driver.launch({ cwd: '/tmp', command: 'cat' });
  const deliverer = makeDeliverer(driver);
  const agent: AgentRuntime = { name: 'bob', status: 'busy', sessionId: sid, inbox: [] };
  const msg: Message = { id: 'm1', from: 'alice', to: 'bob', body: 'hi', ts: 1 };

  deliverer.deliver(agent, [msg]);
  await new Promise((r) => setTimeout(r, 10));

  expect(driver.injections).toHaveLength(1);
  expect(driver.injections[0].sessionId).toBe(sid);
  expect(driver.injections[0].submit).toBe(true);
  expect(driver.injections[0].text).toContain('alice');
});

test('deliver to an agent without sessionId throws synchronously', () => {
  const driver = new FakeDriver();
  const deliverer = makeDeliverer(driver);
  const agent: AgentRuntime = { name: 'bob', status: 'busy', inbox: [] };
  const msg: Message = { id: 'm1', from: 'alice', to: 'bob', body: 'hi', ts: 1 };
  expect(() => deliverer.deliver(agent, [msg])).toThrow(/no sessionId/);
});

test('en locale 下注入格式用英文(投递时实时取词)', () => {
  setLocale('en');
  try {
    const msg: Message = { id: 'm1', from: 'alice', to: 'bob', body: 'hi', ts: 1 };
    const text = formatMessage(msg);
    expect(text).toContain('[From ');
    expect(text).toContain('sendmsg(to=');
  } finally {
    setLocale('zh');
  }
});
