import { expect, test } from 'vitest';
import { parseConsoleInput, matchesFilter, type MessageFilter } from '../../src/console/parse.js';

// —— /filter 解析 ——

test('/filter <name> -> 任一方向(关于某人)', () => {
  expect(parseConsoleInput('/filter bob')).toEqual({ kind: 'filter', filter: { dir: 'any', name: 'bob' } });
});

test('/filter from <name> -> 只看该人发出的', () => {
  expect(parseConsoleInput('/filter from bob')).toEqual({ kind: 'filter', filter: { dir: 'from', name: 'bob' } });
});

test('/filter to <name> -> 只看发给该人的', () => {
  expect(parseConsoleInput('/filter to bob')).toEqual({ kind: 'filter', filter: { dir: 'to', name: 'bob' } });
});

test('/filter 名字带 @ 前缀会被剥掉(与 @补全一致)', () => {
  expect(parseConsoleInput('/filter from @bob')).toEqual({ kind: 'filter', filter: { dir: 'from', name: 'bob' } });
});

test('/filter (不带名) -> 清除过滤', () => {
  expect(parseConsoleInput('/filter')).toEqual({ kind: 'filter-clear' });
});

test('/filter from (有方向词但缺名) -> error', () => {
  expect(parseConsoleInput('/filter from').kind).toBe('error');
});

// —— matchesFilter 谓词 ——

const M = (from: string, to: string) => ({ from, to });

test('filter 为 null -> 全部命中', () => {
  expect(matchesFilter(M('a', 'b'), null)).toBe(true);
});

test('dir=from 只命中发自该人的', () => {
  const f: MessageFilter = { dir: 'from', name: 'bob' };
  expect(matchesFilter(M('bob', 'alice'), f)).toBe(true);
  expect(matchesFilter(M('alice', 'bob'), f)).toBe(false);
});

test('dir=to 只命中发给该人的', () => {
  const f: MessageFilter = { dir: 'to', name: 'bob' };
  expect(matchesFilter(M('alice', 'bob'), f)).toBe(true);
  expect(matchesFilter(M('bob', 'alice'), f)).toBe(false);
});

test('dir=any 任一方向沾边即命中,无关的不中', () => {
  const f: MessageFilter = { dir: 'any', name: 'bob' };
  expect(matchesFilter(M('bob', 'alice'), f)).toBe(true);
  expect(matchesFilter(M('alice', 'bob'), f)).toBe(true);
  expect(matchesFilter(M('alice', 'carol'), f)).toBe(false);
});
