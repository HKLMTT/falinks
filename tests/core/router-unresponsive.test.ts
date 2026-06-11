import { expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import type { AgentRuntime, Message } from '../../src/core/types.js';

function mkRouter() {
  let n = 0;
  let now = 1000;
  const delivered: Message[] = [];
  const r = new Router(
    { deliver: (_a: AgentRuntime, m: Message) => delivered.push(m) },
    { now: () => now, genId: () => `m${++n}` },
  );
  return { r, delivered, setNow: (v: number) => { now = v; } };
}

test('touchMcp 记录时间戳并清 unresponsive(含 rule)与哑巴计数', () => {
  const { r, setNow } = mkRouter();
  r.addAgent('alice');
  r.bumpMute('alice');
  r.markUnresponsive('alice', 'mute');
  expect(r.get('alice')!.unresponsiveRule).toBe('mute'); // rule 随标记存入
  setNow(2000);
  r.touchMcp('alice');
  const a = r.get('alice')!;
  expect(a.lastMcpAt).toBe(2000);
  expect(a.unresponsive).toBe(false);
  expect(a.unresponsiveRule).toBeUndefined(); // 自愈连 rule 一起清
  expect(a.muteStreak).toBe(0);
});

test('touchMcp/touchMcpHttp 未知名宽容不抛(野请求可打任意路径)', () => {
  const { r } = mkRouter();
  expect(() => r.touchMcp('ghost')).not.toThrow();
  expect(() => r.touchMcpHttp('ghost')).not.toThrow();
});

test('touchMcpHttp 只记 HTTP 时间戳,不动 lastMcpAt', () => {
  const { r, setNow } = mkRouter();
  r.addAgent('alice');
  setNow(3000);
  r.touchMcpHttp('alice');
  const a = r.get('alice')!;
  expect(a.lastMcpHttpAt).toBe(3000);
  expect(a.lastMcpAt).toBeUndefined();
});

test('bumpMute 递增并返回当前计数', () => {
  const { r } = mkRouter();
  r.addAgent('alice');
  expect(r.bumpMute('alice')).toBe(1);
  expect(r.bumpMute('alice')).toBe(2);
  expect(r.bumpMute('ghost')).toBe(0); // 未知名宽容
});

test('clearMute 清零哑巴计数,未知名宽容', () => {
  const { r } = mkRouter();
  r.addAgent('alice');
  r.bumpMute('alice');
  r.clearMute('alice');
  expect(r.get('alice')!.muteStreak).toBe(0);
  expect(() => r.clearMute('ghost')).not.toThrow();
});

test('markUnresponsive 边沿触发:首次 true 并存 rule,再标 false', () => {
  const { r } = mkRouter();
  r.addAgent('alice');
  expect(r.markUnresponsive('alice', 'register-timeout')).toBe(true);
  expect(r.get('alice')!.unresponsiveRule).toBe('register-timeout');
  expect(r.markUnresponsive('alice', 'mute')).toBe(false);
  expect(r.get('alice')!.unresponsiveRule).toBe('register-timeout'); // 边沿触发:重复标记不覆盖首因
  expect(r.markUnresponsive('ghost', 'mute')).toBe(false);
});

test('markUnresponsive 对虚拟成员返回 false(boss 从不调 MCP 工具)', () => {
  const { r } = mkRouter();
  r.addVirtual('boss');
  expect(r.markUnresponsive('boss', 'mute')).toBe(false);
});

test('markLaunching 保留 inbox、状态回 launching、清失联痕迹及 MCP 时间戳', () => {
  const { r, setNow } = mkRouter();
  r.addAgent('alice');
  r.register('alice', 's1');          // idle
  r.send('boss-x', 'alice', 'one');   // 投出 → busy(发件人未知名也能送:send 只校验目标)
  r.send('boss-x', 'alice', 'two');   // 排队
  r.bumpMute('alice');
  r.markUnresponsive('alice', 'mute');
  setNow(5000);
  r.touchMcp('alice');
  r.touchMcpHttp('alice');
  r.markLaunching('alice');
  const a = r.get('alice')!;
  expect(a.status).toBe('launching');
  expect(a.inbox.length).toBe(1);     // 排队消息保留
  expect(a.unresponsive).toBe(false);
  expect(a.unresponsiveRule).toBeUndefined(); // 重启清 rule(新进程从零观察)
  expect(a.muteStreak).toBe(0);
  expect(a.handling).toBeUndefined();
  expect(a.handlingFrom).toBeUndefined();
  expect(a.lastMcpAt).toBeUndefined();
  expect(a.lastMcpHttpAt).toBeUndefined();
});

test('markLaunching 对 dead 状态的员工也生效(restart-the-dead)', () => {
  const { r } = mkRouter();
  r.addAgent('alice');
  r.register('alice', 's1');
  r.markDead('alice');
  expect(r.get('alice')!.status).toBe('dead');
  r.markLaunching('alice');
  expect(r.get('alice')!.status).toBe('launching');
});
