import { expect, test } from 'vitest';
import { buildPollScript, parsePollOutput } from '../../src/terminal/iterm.js';
import { FakeDriver } from '../../src/terminal/driver.js';

test('buildPollScript:单次遍历,按 id 分支,带 pinName 的顺带 set name', () => {
  const s = buildPollScript([
    { sessionId: 'AAA-1', pinName: 'lead' },
    { sessionId: 'BBB-2' },
  ]);
  expect(s).toContain('tell application "iTerm2"');
  // 只有一组 repeat 遍历(单次扫描)
  expect(s.match(/repeat with w in windows/g)!.length).toBe(1);
  expect(s).toContain('if sid is "AAA-1"');
  expect(s).toContain('if sid is "BBB-2"');
  expect(s).toContain('set name of s to "lead"');
  // 没给 pinName 的不写名
  expect(s.match(/set name of s/g)!.length).toBe(1);
  expect(s).toContain('is processing of s');
});

test('buildPollScript:pinName 经 AppleScript 转义', () => {
  const s = buildPollScript([{ sessionId: 'A', pinName: 'x"y\\z' }]);
  expect(s).not.toContain('set name of s to "x"y'); // 原文不应裸出现
});

test('parsePollOutput:解析 id\\tprocessing 行,缺席=不存在', () => {
  const m = parsePollOutput('AAA-1\ttrue\nBBB-2\tfalse\n');
  expect(m.get('AAA-1')).toEqual({ processing: true });
  expect(m.get('BBB-2')).toEqual({ processing: false });
  expect(m.has('CCC-3')).toBe(false);
  expect(parsePollOutput('').size).toBe(0);
  expect(parsePollOutput('garbage-line\n\n').size).toBe(0); // 容错:不合格式的行忽略
});

test('FakeDriver.pollPanes:存在的返回 processing,缺席=已关,pinName 落到 names', async () => {
  const d = new FakeDriver();
  const a = await d.launch({ cwd: '/x', command: 'cat' });
  const b = await d.launch({ cwd: '/x', command: 'cat' });
  d.setProcessing(a, true);
  await d.closePane(b);
  const m = await d.pollPanes([{ sessionId: a, pinName: 'alice' }, { sessionId: b }]);
  expect(m.get(a)).toEqual({ processing: true });
  expect(m.has(b)).toBe(false);
  expect(d.names.get(a)).toBe('alice');
});

test('pollPanes 空目标不应触达底层(纯空 Map)', async () => {
  const d = new FakeDriver();
  expect((await d.pollPanes([])).size).toBe(0);
});
