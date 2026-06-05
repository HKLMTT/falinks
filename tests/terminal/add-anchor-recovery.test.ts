import { expect, test } from 'vitest';
import { FakeDriver } from '../../src/terminal/driver.js';
import { chooseAnchor } from '../../src/terminal/anchor.js';

// 复现并锁死 "/add 失败后彻底无法再添加员工" 的根因与修复。
// 根因:新员工 pane 从锚点分裂(splitFrom);锚点 pane 被关后无人重置,splitFrom 拿死锚点会抛错。

test('复现 bug:从已关闭的锚点 pane 分裂会抛错(这正是 /add 卡死的机制)', async () => {
  const d = new FakeDriver();
  const consoleSid = await d.launch({ cwd: '/p', command: 'console' });
  const a = await d.splitFrom(consoleSid, 'horizontal', { cwd: '/p', command: 'claude' });
  await d.closePane(a); // 关掉最近添加的员工(它正是当前锚点)
  // 直接拿死锚点再分裂 —— splitFrom 抛错,模拟 iTerm 的 "anchor not found"
  await expect(d.splitFrom(a, 'horizontal', { cwd: '/p', command: 'claude' })).rejects.toThrow();
});

test('修复:chooseAnchor 探到锚点已死 → 回退控制台 pane,后续 add 成功', async () => {
  const d = new FakeDriver();
  const consoleSid = await d.launch({ cwd: '/p', command: 'console' });
  let lastRight = await d.splitFrom(consoleSid, 'horizontal', { cwd: '/p', command: 'claude' });
  await d.closePane(lastRight); // 锚点 pane 被关 → lastRight 成野指针

  // onAddAgent 的自愈逻辑:先选活着的锚点,再分裂
  const anchor = await chooseAnchor(lastRight, consoleSid, (s) => d.paneExists(s));
  expect(anchor).toBe(consoleSid); // 死锚点被绕过,落到永久兜底
  const added = await d.splitFrom(anchor, 'horizontal', { cwd: '/p', command: 'claude' });
  expect(await d.paneExists(added)).toBe(true); // 新员工 pane 建成,不再卡死
});

test('锚点仍活着时 chooseAnchor 不动它(布局照旧贴在最近的 pane 右侧)', async () => {
  const d = new FakeDriver();
  const consoleSid = await d.launch({ cwd: '/p', command: 'console' });
  const lastRight = await d.splitFrom(consoleSid, 'horizontal', { cwd: '/p', command: 'claude' });
  const anchor = await chooseAnchor(lastRight, consoleSid, (s) => d.paneExists(s));
  expect(anchor).toBe(lastRight);
});
