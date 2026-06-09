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

test('setName / setBackgroundColor 记录到对应 map', async () => {
  const d = new FakeDriver();
  const sid = await d.launch({ cwd: '/tmp', command: 'cat' });
  await d.setName(sid, 'lead');
  await d.setBackgroundColor(sid, '#0a2410');
  expect(d.names.get(sid)).toBe('lead');
  expect(d.backgrounds.get(sid)).toBe('#0a2410');
});

test('isProcessing 默认 false,setProcessing 可设', async () => {
  const d = new FakeDriver();
  const sid = await d.launch({ cwd: '/tmp', command: 'cat' });
  expect(await d.isProcessing(sid)).toBe(false);
  d.setProcessing(sid, true);
  expect(await d.isProcessing(sid)).toBe(true);
});
