import { expect, test } from 'vitest';
import { FakeDriver } from '../../src/terminal/driver.js';

test('launch returns a stable fake session id and remembers the window', async () => {
  const d = new FakeDriver();
  const sid = await d.launch({ cwd: '/tmp', command: 'cat' });
  expect(sid).toBe('fake-session-1');
  expect(d.windows.get(sid)).toEqual({ cwd: '/tmp', command: 'cat' });
});

test('inject records text and submit flag per session', async () => {
  const d = new FakeDriver();
  const sid = await d.launch({ cwd: '/tmp', command: 'cat' });
  await d.inject(sid, 'hello', true);
  await d.inject(sid, 'partial', false);
  expect(d.injections).toEqual([
    { sessionId: sid, text: 'hello', submit: true },
    { sessionId: sid, text: 'partial', submit: false },
  ]);
});

test('readScreen returns canned content set via setScreen', async () => {
  const d = new FakeDriver();
  const sid = await d.launch({ cwd: '/tmp', command: 'cat' });
  d.setScreen(sid, 'line1\nline2');
  expect(await d.readScreen(sid)).toBe('line1\nline2');
});

test('inject to unknown session throws', async () => {
  const d = new FakeDriver();
  await expect(d.inject('nope', 'x', true)).rejects.toThrow(/unknown session/);
});
