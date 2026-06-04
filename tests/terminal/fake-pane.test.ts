import { expect, test } from 'vitest';
import { FakeDriver } from '../../src/terminal/driver.js';

test('splitFrom records anchor+direction and returns a new session id', async () => {
  const d = new FakeDriver();
  const anchor = await d.launch({ cwd: '/c', command: 'console' });
  const sid = await d.splitFrom(anchor, 'vertical', { cwd: '/a', command: 'claude' });
  expect(sid).toBe('fake-session-2');
  expect(d.windows.get(sid)).toEqual({ cwd: '/a', command: 'claude' });
  expect(d.splits).toEqual([{ anchor, direction: 'vertical', sessionId: sid }]);
});

test('closePane removes only that session', async () => {
  const d = new FakeDriver();
  const a = await d.launch({ cwd: '/c', command: 'console' });
  const b = await d.splitFrom(a, 'horizontal', { cwd: '/b', command: 'codex' });
  await d.closePane(b);
  expect(d.windows.has(b)).toBe(false);
  expect(d.windows.has(a)).toBe(true);
});
