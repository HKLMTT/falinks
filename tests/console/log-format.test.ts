import { expect, test } from 'vitest';
import { formatBody, nameColor, formatTime } from '../../src/console/log-format.js';

test('nameColor 确定性:同名同色,且为调色板中的色', () => {
  expect(nameColor('lead')).toBe(nameColor('lead'));
  expect(typeof nameColor('lead')).toBe('string');
  expect(nameColor('lead').length).toBeGreaterThan(0);
});

test('formatTime 输出 HH:MM:SS', () => {
  expect(formatTime(0)).toMatch(/^\d\d:\d\d:\d\d$/);
  expect(formatTime(1700000000000)).toMatch(/^\d\d:\d\d:\d\d$/);
});

test('保留换行、去首尾空行、逐行 trimEnd', () => {
  const r = formatBody('\n第一行  \n第二行\n\n', 12);
  expect(r.lines).toEqual(['第一行', '第二行']);
  expect(r.truncated).toBe(0);
});

test('超过 maxLines 截断且 truncated 计数正确', () => {
  const body = ['a', 'b', 'c', 'd', 'e'].join('\n');
  const r = formatBody(body, 3);
  expect(r.lines).toEqual(['a', 'b', 'c']);
  expect(r.truncated).toBe(2);
});

test('恰好 maxLines 不截断', () => {
  const r = formatBody('a\nb\nc', 3);
  expect(r.lines).toEqual(['a', 'b', 'c']);
  expect(r.truncated).toBe(0);
});

test('空 body', () => {
  expect(formatBody('', 12)).toEqual({ lines: [], truncated: 0 });
  expect(formatBody('   \n  \n', 12)).toEqual({ lines: [], truncated: 0 });
});
