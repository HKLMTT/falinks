import { expect, test } from 'vitest';
import { chooseAnchor } from '../../src/terminal/anchor.js';

test('首选锚点还活着 → 用首选', async () => {
  const got = await chooseAnchor('pane-a', 'console', async () => true);
  expect(got).toBe('pane-a');
});

test('首选锚点已关闭 → 回退到控制台 pane(永久兜底)', async () => {
  const got = await chooseAnchor('dead-pane', 'console', async () => false);
  expect(got).toBe('console');
});

test('首选==兜底时直接返回,不必探测', async () => {
  let probed = false;
  const got = await chooseAnchor('console', 'console', async () => { probed = true; return true; });
  expect(got).toBe('console');
  expect(probed).toBe(false);
});

test('探测本身抛错 → 当作已死,回退兜底(不让 add 崩)', async () => {
  const got = await chooseAnchor('pane-a', 'console', async () => { throw new Error('osascript 抽风'); });
  expect(got).toBe('console');
});
