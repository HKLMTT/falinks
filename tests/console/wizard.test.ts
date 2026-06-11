import { expect, test } from 'vitest';
import { CLIS, dirSuggestions, MODEL_PRESETS } from '../../src/console/wizard.js';

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

test('MODEL_PRESETS:claude 七项,首项默认(undefined),末项自定义哨兵', () => {
  const p = MODEL_PRESETS('claude');
  expect(p.length).toBe(7);
  expect(p[0].value).toBeUndefined();
  expect(p.slice(1, 6).map((x) => x.value)).toEqual(['opus[1m]', 'opus', 'sonnet[1m]', 'sonnet', 'haiku']);
  expect(p[6].value).toBe('custom');
});

test('MODEL_PRESETS:codex 仅 默认+自定义', () => {
  const p = MODEL_PRESETS('codex');
  expect(p.map((x) => x.value)).toEqual([undefined, 'custom']);
});
