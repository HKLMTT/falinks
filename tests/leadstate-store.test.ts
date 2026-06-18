import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadLeadState, saveLeadState, clearLeadState } from '../src/leadstate-store.js';

const root = () => mkdtempSync(join(tmpdir(), 'falinks-leadstate-'));

test('不存在返回空串', () => {
  expect(loadLeadState('/some/proj', root())).toBe('');
});

test('save/load round-trip', () => {
  const r = root();
  saveLeadState('/some/proj', '# 状态\n已完成 A', r);
  expect(loadLeadState('/some/proj', r)).toBe('# 状态\n已完成 A');
});

test('clear 后回到空串', () => {
  const r = root();
  saveLeadState('/some/proj', 'x', r);
  clearLeadState('/some/proj', r);
  expect(loadLeadState('/some/proj', r)).toBe('');
});

test('clear 不存在的文件不抛错', () => {
  expect(() => clearLeadState('/never/written', root())).not.toThrow();
});
