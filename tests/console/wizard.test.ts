import { expect, test } from 'vitest';
import { CLIS, dirSuggestions } from '../../src/console/wizard.js';

// 假的目录列举器：固定几棵目录树
const fake = (base: string): string[] => {
  const tree: Record<string, string[]> = {
    '/tmp/': ['dagent-alice', 'dagent-bob', 'dagent-carol', 'other'],
    '/': ['tmp', 'Users', 'etc'],
    '/Users/': ['liujia'],
  };
  return tree[base] ?? [];
};

test('CLIS enumerates claude and codex', () => {
  expect(CLIS).toEqual(['claude', 'codex']);
});

test('trailing slash lists all subdirs of that dir', () => {
  expect(dirSuggestions('/tmp/', fake)).toEqual([
    '/tmp/dagent-alice', '/tmp/dagent-bob', '/tmp/dagent-carol', '/tmp/other',
  ]);
});

test('partial prefix filters subdirs', () => {
  expect(dirSuggestions('/tmp/dag', fake)).toEqual([
    '/tmp/dagent-alice', '/tmp/dagent-bob', '/tmp/dagent-carol',
  ]);
});

test('root partial filters top-level dirs', () => {
  expect(dirSuggestions('/U', fake)).toEqual(['/Users']);
});

test('empty input lists root', () => {
  expect(dirSuggestions('', fake)).toEqual(['/tmp', '/Users', '/etc']);
});

test('no matches -> empty', () => {
  expect(dirSuggestions('/tmp/zzz', fake)).toEqual([]);
});
